/* Line + area chart — weekly trend, with a value label on every point. */

import { esc, fmtShort, gridMarkup, shortDayLabel, svgChart } from './svg.js';

export function renderLineChart(
  buckets,
  { width = 760, height = 220, padding = 14, paddingLeft = 38, paddingBottom = 24 } = {}
) {
  if (buckets.length < 2) return '';

  const max = Math.max(...buckets.map((b) => b.studySeconds), 60);
  const innerW = width - paddingLeft - padding;
  const innerH = height - padding - paddingBottom;
  const stepX = innerW / (buckets.length - 1);

  const points = buckets.map((bucket, i) => ({
    x: paddingLeft + i * stepX,
    y: padding + (1 - bucket.studySeconds / max) * innerH,
    bucket,
  }));

  const grid = gridMarkup({
    width,
    paddingLeft,
    top: padding,
    plotHeight: innerH,
    max,
    formatLabel: fmtShort,
  });

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
      `<title>${esc(p.bucket.startKey)} → ${esc(p.bucket.endKey)}: ${minutes}m</title></circle>`;

    if (p.bucket.studySeconds > 0) {
      dots += `<text class="chart-line-value" x="${p.x.toFixed(2)}" y="${(p.y - 8).toFixed(2)}" text-anchor="middle">${fmtShort(p.bucket.studySeconds)}</text>`;
    }

    xLabels += `<text class="chart-axis-label" x="${p.x.toFixed(2)}" y="${(height - 6).toFixed(2)}" text-anchor="middle">${esc(shortDayLabel(p.bucket.startKey))}</text>`;
  });

  return svgChart(
    width,
    height,
    grid +
      `<path class="chart-line__area" d="${areaPath}"></path>` +
      `<polyline class="chart-line__path" points="${polyline}"></polyline>` +
      dots +
      xLabels
  );
}
