// Zoom-level readout, live on Leaflet zoom/move events (top-bar stat + map overlay).
import type L from 'leaflet';
import { $ } from '../hud/format.js';

export function wireZoomReadout(map: L.Map): void {
  const update = (): void => {
    const z = map.getZoom();
    const txt = Math.round(z) === z ? String(z) : z.toFixed(1);
    const stat = $('#stat-zoom');
    const ov = $('#ov-zoom');
    if (stat) stat.textContent = 'Z' + txt;
    if (ov) ov.textContent = 'ZOOM ' + txt;
  };
  map.on('zoom zoomend move moveend', update);
  update();
}
