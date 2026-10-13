/* Bar charts: daily (calendar days + goal line) and generic categorical. */

import { esc, fmtShort, gridMarkup, shortDayLabel, svgChart } from './svg.js';

/** Daily study time, with axis labels, gridlines, optional goal line and value labels. */
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
  const labelStep = Math.max(1, Math.round(series.length / 7));

  const grid = gridMarkup({
    width,
    paddingLeft,
    top: paddingTop,
    plotHeight,
    max,
    formatLabel: fmtShort,
  });

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
      `height="${h.toFixed(2)}" rx="2"><title>${esc(d.dayKey)} — ${minutes}m</title></rect>`;

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

  return svgChart(width, height, grid + bars + goalLine + xLabels);
}

/**
 * Categorical bars: categories = [{ label, value, ...anything }].
 * Used for time-of-day, weekday averages, session lengths, months, adherence.
 */
export function renderCategoryBarChart(
  categories,
  {
    width = 760,
    height = 220,
    gap = 10,
    paddingLeft = 38,
    paddingTop = 12,
    paddingBottom = 26,
    formatValue = fmtShort, // (value) => label, for axis ticks and bar values
    formatTooltip = null, // (category) => string; default "label: formatValue(value)"
  } = {}
) {
  if (!categories.length) return '';

  const max = Math.max(...categories.map((c) => c.value), 1);
  const plotWidth = width - paddingLeft;
  const plotHeight = height - paddingTop - paddingBottom;
  const barWidth = (plotWidth - gap * (categories.length - 1)) / categories.length;

  const grid = gridMarkup({
    width,
    paddingLeft,
    top: paddingTop,
    plotHeight,
    max,
    formatLabel: formatValue,
  });

  let bars = '';
  let xLabels = '';
  categories.forEach((c, i) => {
    const x = paddingLeft + i * (barWidth + gap);
    const h = Math.max(c.value > 0 ? 2 : 0, (c.value / max) * plotHeight);
    const y = paddingTop + plotHeight - h;
    const tooltip = formatTooltip ? formatTooltip(c) : `${c.label}: ${formatValue(c.value)}`;

    bars +=
      `<rect class="chart-bar" x="${x.toFixed(2)}" y="${y.toFixed(2)}" width="${Math.max(barWidth, 0.5).toFixed(2)}" ` +
      `height="${h.toFixed(2)}" rx="2"><title>${esc(tooltip)}</title></rect>`;

    if (c.value > 0 && h >= 16) {
      bars += `<text class="chart-bar-value" x="${(x + barWidth / 2).toFixed(2)}" y="${(y - 4).toFixed(2)}" text-anchor="middle">${esc(formatValue(c.value))}</text>`;
    }

    xLabels += `<text class="chart-axis-label" x="${(x + barWidth / 2).toFixed(2)}" y="${(height - 6).toFixed(2)}" text-anchor="middle">${esc(c.label)}</text>`;
  });

  return svgChart(width, height, grid + bars + xLabels);
}
