/* Shared helpers for the inline-SVG charts (markup is built as strings for innerHTML). */

export function esc(value) {
  const map = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return String(value).replace(/[&<>"']/g, (c) => map[c]);
}

/** "2h" / "1.5h" / "45m" / "0" — compact label, no locale conversion. */
export function fmtShort(seconds) {
  if (seconds <= 0) return '0';
  const hours = seconds / 3600;
  if (hours >= 1) return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
  return `${Math.round(seconds / 60)}m`;
}

/** "18/09" from a "YYYY-MM-DD" day key. */
export function shortDayLabel(dayKey) {
  const [, m, d] = dayKey.split('-');
  return `${d}/${m}`;
}

/** N visually-distinct HSL colors for data-driven series counts (e.g. one per subject). */
export function categoricalPalette(n) {
  const count = Math.max(n, 1);
  return Array.from({ length: count }, (_, i) => `hsl(${Math.round((360 / count) * i)} 65% 55%)`);
}

export function svgChart(width, height, inner) {
  return `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img">${inner}</svg>`;
}

/** Horizontal gridlines + left axis labels (5 lines: 0 … max). */
export function gridMarkup({ width, paddingLeft, top, plotHeight, max, formatLabel, steps = 4 }) {
  let out = '';
  for (let i = 0; i <= steps; i++) {
    const frac = i / steps;
    const y = top + plotHeight - frac * plotHeight;
    out +=
      `<line class="chart-gridline" x1="${paddingLeft}" y1="${y.toFixed(2)}" x2="${width}" y2="${y.toFixed(2)}" />` +
      `<text class="chart-axis-label" x="${(paddingLeft - 6).toFixed(2)}" y="${(y + 3).toFixed(2)}" text-anchor="end">${esc(formatLabel(Math.round(frac * max)))}</text>`;
  }
  return out;
}
