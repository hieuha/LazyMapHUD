// Chaser-mode device page (D6): reads this device's own GPS via
// navigator.geolocation.watchPosition (high accuracy) and POSTs fixes to the
// open POST /chaser endpoint on an interval, driving the shared `type:'chaser'`
// entity that the main HUD renders (1 km ring + TARGET LOCKED). Minimal UI —
// not the full HUD — just position readout + a big TRANSMITTING/PAUSED status.
import { resolveDeviceId } from './device-id.js';
import { postChaserFix } from '../net/chaser-post.js';

const POST_INTERVAL_MS = 3000;

interface Fix {
  lat: number;
  lon: number;
  accuracy: number;
  altitude_m?: number;
  heading?: number;
  speed_ms?: number;
}

function setText(id: string, text: string): void {
  const el = document.getElementById(id);
  if (el) el.textContent = text;
}

function setStatus(state: 'idle' | 'transmitting' | 'paused' | 'error', message: string): void {
  const el = document.getElementById('status');
  if (!el) return;
  el.textContent = message;
  el.className = `status ${state}`;
}

class ChasePage {
  private readonly deviceId = resolveDeviceId();
  private watchId: number | null = null;
  private postTimer: ReturnType<typeof setInterval> | null = null;
  private latest: Fix | null = null;
  private transmitting = false;

  start(): void {
    setText('device-id', this.deviceId);

    if (!navigator.geolocation) {
      setStatus('error', 'NO GEOLOCATION SUPPORT');
      return;
    }
    if (!window.isSecureContext) {
      setStatus('error', 'REQUIRES HTTPS (OR LOCALHOST)');
      return;
    }

    this.watchId = navigator.geolocation.watchPosition(
      (pos) => this.onFix(pos),
      (err) => this.onError(err),
      { enableHighAccuracy: true, maximumAge: 2000, timeout: 10_000 },
    );

    this.postTimer = setInterval(() => void this.postLatest(), POST_INTERVAL_MS);
    setStatus('paused', 'ACQUIRING GPS…');
  }

  private onFix(pos: GeolocationPosition): void {
    const c = pos.coords;
    this.latest = {
      lat: c.latitude,
      lon: c.longitude,
      accuracy: c.accuracy,
      altitude_m: c.altitude != null ? c.altitude : undefined,
      heading: c.heading != null && !isNaN(c.heading) ? c.heading : undefined,
      speed_ms: c.speed != null && !isNaN(c.speed) ? c.speed : undefined,
    };
    setText('lat', c.latitude.toFixed(6));
    setText('lon', c.longitude.toFixed(6));
    setText('accuracy', `±${Math.round(c.accuracy)} m`);
    if (!this.transmitting) setStatus('transmitting', 'TRANSMITTING');
    void this.postLatest(); // also post immediately on each fresh fix
  }

  private onError(err: GeolocationPositionError): void {
    this.transmitting = false;
    setStatus('error', `GPS ERROR: ${err.message || err.code}`);
  }

  private async postLatest(): Promise<void> {
    if (!this.latest) return;
    const result = await postChaserFix({
      id: this.deviceId,
      lat: this.latest.lat,
      lon: this.latest.lon,
      altitude_m: this.latest.altitude_m,
      heading: this.latest.heading,
      speed_ms: this.latest.speed_ms,
    });
    if (result.ok) {
      this.transmitting = true;
      setStatus('transmitting', 'TRANSMITTING');
      setText('last-post', new Date().toLocaleTimeString());
    } else {
      this.transmitting = false;
      setStatus('paused', `PAUSED — ${result.reason}`);
    }
  }
}

new ChasePage().start();
