/* =============================================================
   Donut chart — categorical breakdown.

   A segment takes either a fixed `className` (known small set styled in
   CSS, e.g. completed/abandoned/cancelled) or an explicit `color`
   (data-driven count, e.g. one arc per subject). `color` wins.
   ============================================================= */

import { esc } from './svg.js';

/** segments: [{ value, label, className?, color? }]. Returns "" when every value is zero. */
export function renderDonutChart(segments, { size = 148, thickness = 16 } = {}) {
  const total = segments.reduce((sum, seg) => sum + seg.value, 0);
  if (total <= 0) return '';

  const r = (size - thickness) / 2;
  const circumference = 2 * Math.PI * r;
  let offset = 0;

  const arcs = segments
    .filter((seg) => seg.value > 0)
    .map((seg) => {
      const dash = (seg.value / total) * circumference;
      const classAttr = seg.className ? ` ${seg.className}` : '';
      const styleAttr = seg.color ? ` style="stroke: ${seg.color}"` : '';

      const circle =
        `<circle class="chart-donut-segment${classAttr}" cx="${size / 2}" cy="${size / 2}" r="${r}" ` +
        `stroke-width="${thickness}" fill="none"${styleAttr} ` +
        `stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}" ` +
        `stroke-dashoffset="${(-offset).toFixed(2)}"><title>${esc(seg.label)}: ${seg.value}</title></circle>`;

      offset += dash;
      return circle;
    })
    .join('');

  return (
    `<svg class="chart-donut" viewBox="0 0 ${size} ${size}" role="img">` +
    `<circle class="chart-donut-track" cx="${size / 2}" cy="${size / 2}" r="${r}" stroke-width="${thickness}" fill="none" />` +
    `<g transform="rotate(-90 ${size / 2} ${size / 2})">${arcs}</g>` +
    `</svg>`
  );
}
