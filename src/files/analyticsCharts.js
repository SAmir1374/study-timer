/* =============================================================
   analyticsCharts.js

   Builds inline SVG markup for the analytics page. No dependencies,
   no state — pure functions that take plain data and return an SVG
   string. Colors come from CSS classes by default; a few charts with
   a data-driven number of series (subjects) accept an explicit
   `color` per segment instead, since a fixed class-per-subject
   palette isn't possible ahead of time.
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

/** "2h" / "1.5h" / "45m" / "0" — compact axis/value label, no locale conversion. */
function fmtShort(seconds) {
  if (seconds <= 0) return '0';
  const hours = seconds / 3600;
  if (hours >= 1) return `${Number.isInteger(hours) ? hours : hours.toFixed(1)}h`;
  return `${Math.round(seconds / 60)}m`;
}

/** "18/09" from a "YYYY-MM-DD" day key — matches the dayLabel() convention in analyticsApp.js. */
function shortDayLabel(dayKey) {
  const [, m, d] = dayKey.split('-');
  return `${d}/${m}`;
}

/** N visually-distinct HSL colors for data-driven series counts (e.g. one per subject). */
export function categoricalPalette(n) {
  const count = Math.max(n, 1);
  return Array.from({ length: count }, (_, i) => `hsl(${Math.round((360 / count) * i)} 65% 55%)`);
}

/* ------------------------------------------------------------
   Bar chart — daily study time, with axis labels, gridlines,
   an optional goal reference line, and a value label per bar.
   ------------------------------------------------------------ */

export function renderBarChart(
  series,
  {
    goalSeconds = 0,
    width = 760,
    height = 220,
    gap = 3,
    paddingLeft = 38,
    paddingTop = 12,
    paddingBottom = 20,
  } = {}
) {
  if (!series.length) return '';

  const max = Math.max(goalSeconds, ...series.map((d) => d.studySeconds), 60);
  const plotWidth = width - paddingLeft;
  const plotHeight = height - paddingTop - paddingBottom;
  const barWidth = (plotWidth - gap * (series.length - 1)) / series.length;

  const gridSteps = 4;
  let grid = '';
  for (let i = 0; i <= gridSteps; i++) {
    const frac = i / gridSteps;
    const y = paddingTop + plotHeight - frac * plotHeight;
    grid +=
      `<line class="chart-gridline" x1="${paddingLeft}" y1="${y.toFixed(2)}" x2="${width}" y2="${y.toFixed(2)}" />` +
      `<text class="chart-axis-label" x="${(paddingLeft - 6).toFixed(2)}" y="${(y + 3).toFixed(2)}" text-anchor="end">${fmtShort(Math.round(frac * max))}</text>`;
  }

  const labelStep = Math.max(1, Math.round(series.length / 7));

  let bars = '';
  let xLabels = '';
  series.forEach((d, i) => {
    const x = paddingLeft + i * (barWidth + gap);
    const h = Math.max(d.studySeconds > 0 ? 2 : 0, (d.studySeconds / max) * plotHeight);
    const y = paddingTop + plotHeight - h;
    const met = goalSeconds > 0 && d.studySeconds >= goalSeconds;
    const minutes = Math.round(d.studySeconds / 60);

    bars +=
      `<rect class="chart-bar${met ? ' chart-bar--goal-met' : ''}" ` +
      `x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${Math.max(barWidth, 0.5).toFixed(2)}" ` +
      `height="${h.toFixed(2)}" rx="2">` +
      `<title>${esc(d.dayKey)} — ${minutes}m</title>` +
      `</rect>`;

    if (d.studySeconds > 0 && h >= 16) {
      bars += `<text class="chart-bar-value" x="${(x + barWidth / 2).toFixed(2)}" y="${(y - 4).toFixed(2)}" text-anchor="middle">${fmtShort(d.studySeconds)}</text>`;
    }

    if (i % labelStep === 0 || i === series.length - 1) {
      xLabels += `<text class="chart-axis-label" x="${(x + barWidth / 2).toFixed(2)}" y="${(height - 4).toFixed(2)}" text-anchor="middle">${esc(shortDayLabel(d.dayKey))}</text>`;
    }
  });

  const goalY = paddingTop + plotHeight - (goalSeconds / max) * plotHeight;
  const goalLine =
    goalSeconds > 0
      ? `<line class="chart-goal-line" x1="${paddingLeft}" y1="${goalY.toFixed(2)}" x2="${width}" y2="${goalY.toFixed(2)}" />`
      : '';

  return (
    `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img">` +
    grid +
    bars +
    goalLine +
    xLabels +
    `</svg>`
  );
}

/* ------------------------------------------------------------
   Line + area chart — weekly trend, with axis labels, gridlines,
   and a value label on every point (only 12 buckets, so no crowding).
   ------------------------------------------------------------ */

export function renderLineChart(
  buckets,
  { width = 760, height = 220, padding = 14, paddingLeft = 38, paddingBottom = 24 } = {}
) {
  if (buckets.length < 2) return '';

  const max = Math.max(...buckets.map((b) => b.studySeconds), 60);
  const innerW = width - paddingLeft - padding;
  const innerH = height - padding - paddingBottom;
  const stepX = innerW / (buckets.length - 1);

  const points = buckets.map((b, i) => ({
    x: paddingLeft + i * stepX,
    y: padding + (1 - b.studySeconds / max) * innerH,
    bucket: b,
  }));

  const gridSteps = 4;
  let grid = '';
  for (let i = 0; i <= gridSteps; i++) {
    const frac = i / gridSteps;
    const y = padding + innerH - frac * innerH;
    grid +=
      `<line class="chart-gridline" x1="${paddingLeft}" y1="${y.toFixed(2)}" x2="${width}" y2="${y.toFixed(2)}" />` +
      `<text class="chart-axis-label" x="${(paddingLeft - 6).toFixed(2)}" y="${(y + 3).toFixed(2)}" text-anchor="end">${fmtShort(Math.round(frac * max))}</text>`;
  }

  const polyline = points.map((p) => `${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ');

  const floorY = padding + innerH;
  const areaPath =
    `M${points[0].x.toFixed(2)},${floorY.toFixed(2)} ` +
    points.map((p) => `L${p.x.toFixed(2)},${p.y.toFixed(2)}`).join(' ') +
    ` L${points[points.length - 1].x.toFixed(2)},${floorY.toFixed(2)} Z`;

  let dots = '';
  let xLabels = '';
  points.forEach((p) => {
    const minutes = Math.round(p.bucket.studySeconds / 60);
    dots +=
      `<circle class="chart-line__dot" cx="${p.x.toFixed(2)}" cy="${p.y.toFixed(2)}" r="3.5">` +
      `<title>${esc(p.bucket.startKey)} → ${esc(p.bucket.endKey)}: ${minutes}m</title>` +
      `</circle>`;
    if (p.bucket.studySeconds > 0) {
      dots += `<text class="chart-line-value" x="${p.x.toFixed(2)}" y="${(p.y - 8).toFixed(2)}" text-anchor="middle">${fmtShort(p.bucket.studySeconds)}</text>`;
    }
    xLabels += `<text class="chart-axis-label" x="${p.x.toFixed(2)}" y="${(height - 6).toFixed(2)}" text-anchor="middle">${esc(shortDayLabel(p.bucket.startKey))}</text>`;
  });

  return (
    `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img">` +
    grid +
    `<path class="chart-line__area" d="${areaPath}"></path>` +
    `<polyline class="chart-line__path" points="${polyline}"></polyline>` +
    dots +
    xLabels +
    `</svg>`
  );
}

/* ------------------------------------------------------------
   Generic categorical bar chart — reused for time-of-day, day-of-
   week averages, session-length buckets, and monthly totals. Unlike
   renderBarChart, categories are arbitrary labels, not calendar days.
   ------------------------------------------------------------ */

export function renderCategoryBarChart(
  categories,
  {
    width = 760,
    height = 220,
    gap = 10,
    paddingLeft = 38,
    paddingTop = 12,
    paddingBottom = 26,
    formatValue = fmtShort, // (value) => label string, for both axis ticks and bar values
    formatTooltip = null, // (category) => string; defaults to "label: formatValue(value)"
  } = {}
) {
  if (!categories.length) return '';

  const max = Math.max(...categories.map((c) => c.value), 1);
  const plotWidth = width - paddingLeft;
  const plotHeight = height - paddingTop - paddingBottom;
  const barWidth = (plotWidth - gap * (categories.length - 1)) / categories.length;

  const gridSteps = 4;
  let grid = '';
  for (let i = 0; i <= gridSteps; i++) {
    const frac = i / gridSteps;
    const y = paddingTop + plotHeight - frac * plotHeight;
    grid +=
      `<line class="chart-gridline" x1="${paddingLeft}" y1="${y.toFixed(2)}" x2="${width}" y2="${y.toFixed(2)}" />` +
      `<text class="chart-axis-label" x="${(paddingLeft - 6).toFixed(2)}" y="${(y + 3).toFixed(2)}" text-anchor="end">${esc(formatValue(Math.round(frac * max)))}</text>`;
  }

  let bars = '';
  let xLabels = '';
  categories.forEach((c, i) => {
    const x = paddingLeft + i * (barWidth + gap);
    const h = Math.max(c.value > 0 ? 2 : 0, (c.value / max) * plotHeight);
    const y = paddingTop + plotHeight - h;
    const tooltip = formatTooltip ? formatTooltip(c) : `${c.label}: ${formatValue(c.value)}`;

    bars +=
      `<rect class="chart-bar" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${Math.max(barWidth, 0.5).toFixed(2)}" ` +
      `height="${h.toFixed(2)}" rx="2">` +
      `<title>${esc(tooltip)}</title>` +
      `</rect>`;

    if (c.value > 0 && h >= 16) {
      bars += `<text class="chart-bar-value" x="${(x + barWidth / 2).toFixed(2)}" y="${(y - 4).toFixed(2)}" text-anchor="middle">${esc(formatValue(c.value))}</text>`;
    }

    xLabels += `<text class="chart-axis-label" x="${(x + barWidth / 2).toFixed(2)}" y="${(height - 6).toFixed(2)}" text-anchor="middle">${esc(c.label)}</text>`;
  });

  return (
    `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img">` +
    grid +
    bars +
    xLabels +
    `</svg>`
  );
}

/* ------------------------------------------------------------
   Donut chart — categorical breakdown

   Segments take either a fixed `className` (for a known, small set of
   categories already styled in CSS — e.g. completed/abandoned/cancelled)
   or an explicit `color` (for a data-driven series count — e.g. one
   arc per subject, via categoricalPalette()). `color`, when present,
   wins over whatever the class would otherwise paint.
   ------------------------------------------------------------ */

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