// Alpha-numeric HUD grid frame (A-G rows / 1-10 cols) rendered as an SVG overlay
// behind the canvas. Rebuilt on resize with the current pixel dimensions.
import { $, GRID_ROWS, GRID_COLS } from './format.js';

export function buildHudGrid(hw: number, hh: number): void {
  const host = $('#hud-grid');
  if (!host || hw < 1 || hh < 1) return;
  const W = hw;
  const H = hh;
  let s = `<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}" style="position:absolute;inset:0;width:100%;height:100%">`;
  for (let c = 0; c <= GRID_COLS; c++) {
    const x = (c / GRID_COLS) * W;
    const strong = c % 5 === 0;
    s += `<line x1="${x}" y1="0" x2="${x}" y2="${H}" stroke="rgba(55,224,255,${strong ? 0.2 : 0.08})" stroke-width="1"/>`;
    if (c < GRID_COLS)
      s += `<text x="${x + 5}" y="14" fill="rgba(55,224,255,0.5)" font-family="ui-monospace,monospace" font-size="9">${String(c + 1).padStart(2, '0')}</text>`;
  }
  for (let r = 0; r <= GRID_ROWS.length; r++) {
    const y = (r / GRID_ROWS.length) * H;
    s += `<line x1="0" y1="${y}" x2="${W}" y2="${y}" stroke="rgba(55,224,255,0.08)" stroke-width="1"/>`;
    if (r < GRID_ROWS.length)
      s += `<text x="6" y="${y + H / GRID_ROWS.length / 2 + 3}" fill="rgba(55,224,255,0.5)" font-family="ui-monospace,monospace" font-size="9">${GRID_ROWS[r]}</text>`;
  }
  s += `</svg>`;
  host.innerHTML = s;
}
