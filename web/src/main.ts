// Composition root. Default boot is LIVE — a WebSocketSource against the real
// hub, starting with an EMPTY roster (no fake/inlined data). Entities only
// appear once the server actually broadcasts them (webhook-fed); a
// disconnected boot stays an empty map + RECONNECTING pill, not fake data.
import 'leaflet/dist/leaflet.css';
import './styles/hud.css';

import { EntityEngine } from './entities/entity-engine.js';
import { WebSocketSource } from './entities/ws-source.js';
import { store } from './state/store.js';

import { MapController } from './map/leaflet-map.js';
import { BasemapController, initBasemapMenu } from './map/basemaps.js';
import { HudCanvas } from './hud/hud-canvas.js';
import { Roster } from './panels/roster.js';
import { DetailReadout } from './panels/detail-readout.js';
import { AltitudeLadder } from './panels/altitude-ladder.js';
import { Proximity } from './chaser/proximity.js';
import { resolveMyChaser, initMyChaserId } from './chaser/my-chaser.js';
import { MyChaserPicker } from './controls/my-chaser-picker.js';
import { wireChaseMode } from './controls/chase-mode.js';
import { ConnectionStatus } from './ui/connection-status.js';

import { wireUnitsToggle } from './controls/units.js';
import { wireTimezoneToggle } from './controls/timezone.js';
import { wireHeaderClock } from './controls/header-clock.js';
import { wireZoomReadout } from './controls/zoom-readout.js';
import { wireTrackControls, setLockUI } from './controls/track-lock.js';
import { wireTrailHydration } from './controls/trail-hydration.js';
import { createSourceHandlers } from './controls/source-handlers.js';

function boot(): void {
  const engine = new EntityEngine();
  const connection = new ConnectionStatus();
  const liveSource = new WebSocketSource(engine, (status) => {
    if (status === 'open') connection.set('live');
    else if (status === 'connecting' || status === 'reconnecting') connection.set('reconnecting');
  });

  const getSelected = () => engine.entities.find((e) => e.id === store.selectedId);

  // panels/detail need the map projection; declared before map via late binding.
  let mapCtrl: MapController;
  const detail = new DetailReadout(
    engine,
    () => mapCtrl.map.getSize(),
    (lat, lon) => mapCtrl.pt(lat, lon),
  );

  const hydrateTrail = wireTrailHydration(engine);

  const selectAndTrack = (id: string): void => {
    store.selectedId = id;
    detail.select(id);
    roster.refresh();
    mapCtrl.selectAndTrack(id);
    setLockUI(true);
    hydrateTrail(id);
  };

  mapCtrl = new MapController(engine, getSelected, selectAndTrack);
  const basemaps = new BasemapController(mapCtrl.map);
  const proximity = new Proximity(engine, mapCtrl);
  const hud = new HudCanvas(
    engine,
    (lat, lon) => mapCtrl.pt(lat, lon),
    () => mapCtrl.map.getSize(),
    proximity.warnIds,
    () => mapCtrl.map.getZoom(),
  );
  const roster = new Roster(engine.entities, selectAndTrack, proximity.warnIds);
  const ladder = new AltitudeLadder('#ladder', engine.entities, false);
  const ladderM = new AltitudeLadder('#ladder-m', engine.entities, true);

  // Seed the viewer's own chaser from ?me=/localStorage, then keep the picker
  // in sync as chasers come and go.
  initMyChaserId();
  wireChaseMode(); // ?chase=<name> turns this HUD into that chaser (GPS uplink)
  const mePicker = new MyChaserPicker(engine, (id) => {
    const c = engine.chasers.get(id);
    if (c) mapCtrl.panToChaser(c); // selecting a chaser pans + (chase mode) tracks it
  });

  const { handlers: sourceHandlers } = createSourceHandlers(engine, roster, detail, selectAndTrack);

  // --- controls ---
  wireUnitsToggle(() => {
    detail.update();
    ladder.draw();
    ladderM.draw();
  });
  const renderClock = wireHeaderClock();
  wireTimezoneToggle(() => {
    detail.update();
    renderClock(); // reflect UTC/ICT switch immediately
  });
  wireZoomReadout(mapCtrl.map);
  wireTrackControls();
  initBasemapMenu(basemaps);
  setLockUI(true);
  detail.clear(); // clean empty HUD until real data arrives (roster 00, TRACKING —)

  // --- boot the live source (default) — empty roster until real data arrives ---
  connection.set('reconnecting');
  liveSource.start(sourceHandlers);

  // --- sizing ---
  hud.size();
  ladder.size();
  ladderM.size();
  const onResize = (): void => {
    mapCtrl.map.invalidateSize();
    hud.size();
    ladder.size();
    ladderM.size();
  };
  let resizeT = 0;
  window.addEventListener('resize', () => {
    clearTimeout(resizeT);
    resizeT = window.setTimeout(onResize, 120);
  });

  // --- main loop: everything redraws on rAF (not only on Leaflet events) ---
  let last = performance.now();
  let acc = 0;
  const loop = (now: number): void => {
    // clamp to [0,60] ms: rAF's first timestamp can precede the `last` seed
    // (different clock sampling) — keeps followCam's time-constant math stable.
    const dt = Math.min(Math.max(now - last, 0), 60);
    last = now;
    liveSource.tick(dt);
    mapCtrl.syncRing(resolveMyChaser(engine));
    mapCtrl.followCam(now, dt);
    proximity.update();
    hud.draw(now);
    ladder.draw();
    if (window.innerWidth < 768) ladderM.draw();
    acc += dt;
    if (acc > 120) {
      acc = 0;
      roster.refresh();
      mePicker.refresh();
      detail.update();
    }
    requestAnimationFrame(loop);
  };

  // deferred settle: invalidate size (recentres only once a real target exists)
  window.setTimeout(() => {
    mapCtrl.map.invalidateSize();
    hud.size();
    const sel = getSelected();
    if (sel?.cur) {
      store.isProgrammaticMove = true;
      mapCtrl.map.setView([sel.cur.lat, sel.cur.lon], 13, { animate: false });
      store.isProgrammaticMove = false;
    }
  }, 80);

  basemaps.initTint();
  requestAnimationFrame(loop);
}

boot();
