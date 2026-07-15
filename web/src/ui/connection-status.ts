// Connection status pill — a live LIVE / RECONNECTING indicator driven by the
// WebSocketSource's reconnect status (see net/reconnect.ts).
import { $ } from '../hud/format.js';

export type ConnectionMode = 'live' | 'reconnecting';

const LABEL: Record<ConnectionMode, string> = {
  live: 'LIVE',
  reconnecting: 'RECONNECTING',
};

export class ConnectionStatus {
  private readonly pill: HTMLElement | null;
  private readonly label: HTMLElement | null;

  constructor() {
    this.pill = $('#feed-pill');
    this.label = $('#feed-label');
  }

  set(mode: ConnectionMode): void {
    if (this.label) this.label.textContent = LABEL[mode];
    if (!this.pill) return;
    this.pill.classList.remove('live', 'reconnecting');
    this.pill.classList.add(mode);
  }
}
