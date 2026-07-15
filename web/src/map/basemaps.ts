// Selectable basemaps (keyless raster providers) + the top-bar "MAP ▾" popover.
// maxNativeZoom is set on layers whose native max < 18 so click-to-track flyTo(18)
// UPSCALES the last native tiles instead of showing blank tiles. `tint` = dark
// tactical overlay opacity (heavier over bright basemaps so HUD stays legible).
import L from 'leaflet';
import { $, clamp } from '../hud/format.js';

interface BaseDef {
  key: string;
  label: string;
  url?: string;
  opts?: L.TileLayerOptions;
  tint?: number;
  disabled?: boolean;
}

const ESRI_IMAGERY_ATTR =
  'Tiles © Esri — Source: Esri, i-cubed, USDA, USGS, AEX, GeoEye, Getmapping, Aerogrid, IGN, IGP, UPR-EGP, and the GIS User Community';
const CARTO_ATTR = '© OpenStreetMap contributors © CARTO';

export const BASE_DEFS: BaseDef[] = [
  { key: 'WorldImagery', label: 'WorldImagery', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Imagery/MapServer/tile/{z}/{y}/{x}', opts: { maxZoom: 19, attribution: ESRI_IMAGERY_ATTR }, tint: 0.55 },
  { key: 'DarkMatter', label: 'DarkMatter', url: 'https://{s}.basemaps.cartocdn.com/dark_all/{z}/{x}/{y}{r}.png', opts: { subdomains: 'abcd', maxZoom: 20, attribution: CARTO_ATTR }, tint: 0.3 },
  { key: 'Mapnik', label: 'Mapnik', url: 'https://tile.openstreetmap.org/{z}/{x}/{y}.png', opts: { maxZoom: 19, attribution: '© OpenStreetMap contributors' }, tint: 0.92 },
  { key: 'Voyager', label: 'Voyager', url: 'https://{s}.basemaps.cartocdn.com/rastertiles/voyager/{z}/{x}/{y}{r}.png', opts: { subdomains: 'abcd', maxZoom: 20, attribution: CARTO_ATTR }, tint: 0.85 },
  { key: 'Terrain', label: 'Terrain', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/World_Terrain_Base/MapServer/tile/{z}/{y}/{x}', opts: { maxNativeZoom: 13, maxZoom: 19, attribution: 'Esri' }, tint: 0.9 },
  { key: 'OpenTopoMap', label: 'OpenTopoMap', url: 'https://{s}.tile.opentopomap.org/{z}/{x}/{y}.png', opts: { subdomains: 'abc', maxNativeZoom: 17, maxZoom: 19, attribution: 'Map data: © OpenStreetMap contributors, SRTM | Map style: © OpenTopoMap (CC-BY-SA)' }, tint: 0.88 },
  { key: 'Hillshade', label: 'Hillshade', url: 'https://server.arcgisonline.com/ArcGIS/rest/services/Elevation/World_Hillshade/MapServer/tile/{z}/{x}/{y}', opts: { maxNativeZoom: 16, maxZoom: 19, attribution: 'Esri, USGS' }, tint: 0.7 },
  // HighSight: greyed placeholder for a future custom tile source — not selectable.
  { key: 'HighSight', label: 'HighSight', disabled: true },
];

export class BasemapController {
  private readonly layers: Record<string, L.TileLayer> = {};
  private readonly tints: Record<string, number> = {};
  current = 'WorldImagery';

  constructor(private readonly map: L.Map) {
    BASE_DEFS.forEach((d) => {
      if (d.disabled || !d.url) return;
      this.layers[d.key] = L.tileLayer(d.url, d.opts);
      if (d.tint != null) this.tints[d.key] = d.tint;
    });
    this.layers[this.current]!.addTo(map);
  }

  private applyTint(name: string): void {
    const tint = document.getElementById('map-tint');
    if (!tint) return;
    const v = this.tints[name] != null ? this.tints[name]! : 0.6;
    tint.style.opacity = String(clamp(v, 0, 1));
  }

  set(name: string): void {
    if (!this.layers[name] || name === this.current) return;
    Object.entries(this.layers).forEach(([k, layer]) => {
      if (k === name) {
        if (!this.map.hasLayer(layer)) layer.addTo(this.map);
      } else if (this.map.hasLayer(layer)) {
        this.map.removeLayer(layer);
      }
    });
    this.current = name;
    this.applyTint(name);
  }

  /** Set the initial tint for the default basemap. */
  initTint(): void {
    this.applyTint(this.current);
  }
}

/** Wire the "MAP ▾" dark popover radio list to the basemap controller. */
export function initBasemapMenu(ctrl: BasemapController): void {
  const ddBtn = $<HTMLButtonElement>('#map-dd-btn');
  const ddPop = $<HTMLDivElement>('#map-dd-pop');
  const ddCur = $<HTMLSpanElement>('#map-dd-cur');
  if (!ddBtn || !ddPop || !ddCur) return;

  const open = (): void => {
    ddPop.classList.add('open');
    ddBtn.setAttribute('aria-expanded', 'true');
  };
  const close = (): void => {
    ddPop.classList.remove('open');
    ddBtn.setAttribute('aria-expanded', 'false');
  };

  const build = (): void => {
    ddPop.innerHTML = '';
    BASE_DEFS.forEach((d) => {
      const opt = document.createElement('div');
      opt.className = 'map-opt' + (d.disabled ? ' disabled' : '') + (d.key === ctrl.current ? ' on' : '');
      opt.setAttribute('role', 'option');
      if (d.disabled) opt.title = 'custom tile source — configured in production';
      opt.innerHTML =
        `<span class="radio"></span><span>${d.label}</span>` + (d.disabled ? `<span class="tagx">soon</span>` : ``);
      if (!d.disabled) {
        opt.addEventListener('click', () => {
          ctrl.set(d.key);
          ddCur.textContent = d.label;
          build();
          close();
        });
      }
      ddPop.appendChild(opt);
    });
  };

  ddBtn.addEventListener('click', (e) => {
    e.stopPropagation();
    ddPop.classList.contains('open') ? close() : open();
  });
  document.addEventListener('click', (e) => {
    if (!$('#map-dd')?.contains(e.target as Node)) close();
  });
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') close();
  });
  build();
}
