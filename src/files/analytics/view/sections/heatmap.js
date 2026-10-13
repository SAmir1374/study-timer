/* GitHub-style activity heatmap (Saturday-first columns). */

import { fmtHoursMinutes } from '../../../timer.js';
import { buildActivityHeatmap } from '../../data/index.js';
import { el } from '../elements.js';
import { HEATMAP_DAYS } from '../constants.js';

const DAY_NAMES = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج']; // Sat..Fri
const LEVELS = [0, 1, 2, 3, 4, 5];

function cellHtml(cell) {
  if (!cell.dayKey) return '<div class="heatmap-cell" style="opacity:0"></div>';
  return `<div class="heatmap-cell heatmap-cell--l${cell.level}" title="${cell.dayKey}: ${fmtHoursMinutes(cell.seconds)}"></div>`;
}

export function renderHeatmap(sessions) {
  if (!el.activityHeatmap) return;

  const { weeks } = buildActivityHeatmap(sessions, HEATMAP_DAYS);

  const labels = DAY_NAMES.map(
    (n) =>
      `<span style="height:15px;font-size:9px;color:var(--text-3);line-height:15px;text-align:center;width:14px">${n}</span>`
  ).join('');

  const columns = weeks
    .map((week) => `<div class="heatmap-week">${week.map(cellHtml).join('')}</div>`)
    .join('');

  el.activityHeatmap.innerHTML = `
    <div style="display:flex;gap:8px">
      <div style="display:flex;flex-direction:column;gap:3px;padding-top:0">${labels}</div>
      <div class="heatmap-grid">${columns}</div>
    </div>
  `;

  if (el.heatmapLegend) {
    el.heatmapLegend.innerHTML = `
      <span class="heatmap-legend__label">کم</span>
      ${LEVELS.map((l) => `<span class="heatmap-legend__swatch heatmap-cell--l${l}"></span>`).join('')}
      <span class="heatmap-legend__label">زیاد</span>
    `;
  }
}
