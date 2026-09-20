/* =============================================================
   analyticsCharts.js

   Builds inline SVG markup for the analytics page. No dependencies,
   no state — pure functions that take plain data and return an SVG
   string. All colors come from CSS classes (see style.css §38),
   never inline styles, matching the .timer-ring / .ring-progress
   convention already used on the main page.
   ============================================================= */

const NS = 'http://www.w3.org/2000/svg';
void NS; // markup is built as strings (innerHTML), not via createElementNS

export function esc(value) {
  return String(value).replace(
    /[&<>"']/g,
    (c) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[c]
  );
}

/* ------------------------------------------------------------
   Bar chart — daily study time, with an optional goal reference line
   ------------------------------------------------------------ */

export function renderBarChart(
  series,
  { goalSeconds = 0, width = 720, height = 190, gap = 3 } = {}
) {
  if (!series.length) return '';

  const max = Math.max(goalSeconds, ...series.map((d) => d.studySeconds), 60);
  const barWidth = (width - gap * (series.length - 1)) / series.length;

  const bars = series
    .map((d, i) => {
      const x = i * (barWidth + gap);
      const h = Math.max(d.studySeconds > 0 ? 2 : 0, (d.studySeconds / max) * height);
      const y = height - h;
      const met = goalSeconds > 0 && d.studySeconds >= goalSeconds;
      const minutes = Math.round(d.studySeconds / 60);
      return (
        `<rect class="chart-bar${met ? ' chart-bar--goal-met' : ''}" ` +
        `x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${Math.max(barWidth, 0.5).toFixed(2)}" ` +
        `height="${h.toFixed(2)}" rx="2">` +
        `<title>${esc(d.dayKey)} — ${minutes}</title>` +
        `</rect>`
      );
    })
    .join('');

  const goalLine =
    goalSeconds > 0
      ? `<line class="chart-goal-line" x1="0" y1="${(height - (goalSeconds / max) * height).toFixed(2)}" ` +
        `x2="${width}" y2="${(height - (goalSeconds / max) * height).toFixed(2)}" />`
      : '';

  return (
    `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img">` +
    bars +
    goalLine +
    `</svg>`
  );
}

/* ------------------------------------------------------------
   Line + area chart — weekly trend
   ------------------------------------------------------------ */

export function renderLineChart(buckets, { width = 720, height = 190, padding = 14 } = {}) {
  if (buckets.length < 2) return '';

  const max = Math.max(...buckets.map((b) => b.studySeconds), 60);
  const innerW = width - padding * 2;
  const innerH = height - padding * 2;
  const stepX = innerW / (buckets.length - 1);

  const points = buckets.map((b, i) => ({
    x: padding + i * stepX,
    y: padding + (1 - b.studySeconds / max) * innerH,
    bucket: b,
  }));

  const polyline = points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

  const floorY = height - padding;
  const areaPath =
    `M${points[0].x.toFixed(2)},${floorY.toFixed(2)} ` +
    points.map((p) => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ') +
    ` L${points[points.length - 1].x.toFixed(2)},${floorY.toFixed(2)} Z`;

  const dots = points
    .map((p) => {
      const minutes = Math.round(p.bucket.studySeconds / 60);
      return (
        `<circle class="chart-line__dot" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="3.5">` +
        `<title>${esc(p.bucket.startKey)} → ${esc(p.bucket.endKey)}: ${minutes}</title>` +
        `</circle>`
      );
    })
    .join('');

  return (
    `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img">` +
    `<path class="chart-line__area" d="${areaPath}"></path>` +
    `<polyline class="chart-line__path" points="${polyline}"></polyline>` +
    dots +
    `</svg>`
  );
}

/* ------------------------------------------------------------
   Donut chart — categorical breakdown
   ------------------------------------------------------------ */

/** segments: [{ value, className }]. Returns "" when every value is zero. */
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
      const circle =
        `<circle class="chart-donut-segment ${seg.className}" cx="${size / 2}" cy="${size / 2}" r="${r}" ` +
        `stroke-width="${thickness}" fill="none" ` +
        `stroke-dasharray="${dash.toFixed(2)} ${(circumference - dash).toFixed(2)}" ` +
        `stroke-dashoffset="${(-offset).toFixed(2)}">` +
        `<title>${esc(seg.label)}: ${seg.value}</title>` +
        `</circle>`;
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
