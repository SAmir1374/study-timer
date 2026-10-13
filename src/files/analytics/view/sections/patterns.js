/* Time-pattern and session-quality charts. */

import {
  buildDaypartDistribution,
  buildHourOfDayDistribution,
  buildSessionLengthDistribution,
  buildWeekdayAverages,
} from '../../data/index.js';
import { esc, renderCategoryBarChart, renderDonutChart } from '../../charts/index.js';
import { el } from '../elements.js';
import {
  SESSION_LENGTH_LABELS,
  WEEKDAY_DISPLAY_ORDER,
  WEEKDAY_LABELS,
} from '../i18n.js';
import { lang, tr } from '../prefs.js';

const EMPTY = '<div class="chart-empty">—</div>';

const swatch = (className, text) =>
  `<span class="chart-legend__item"><span class="chart-legend__swatch ${className}"></span>${text}</span>`;

/* ---------- when you study ---------- */

export function renderHourChart(sessions) {
  if (!el.hourChart) return;

  const categories = buildHourOfDayDistribution(sessions).map((d) => ({
    label: String(d.hour).padStart(2, '0'),
    value: d.seconds,
  }));

  el.hourChart.innerHTML =
    renderCategoryBarChart(categories, { gap: 4, formatValue: (v) => `${Math.round(v / 60)}m` }) || EMPTY;
}

export function renderDaypartChart(sessions) {
  if (!el.daypartChart) return;

  const t = tr();
  const labels = { morning: t.morning, afternoon: t.afternoon, evening: t.evening, night: t.night };
  const categories = buildDaypartDistribution(sessions).map((d) => ({
    label: labels[d.key],
    value: d.seconds,
  }));

  el.daypartChart.innerHTML = renderCategoryBarChart(categories, { gap: 24 }) || EMPTY;
}

export function renderWeekdayChart(sessions) {
  if (!el.weekdayChart) return;

  const language = lang();
  const labels = WEEKDAY_LABELS[language];
  const averages = buildWeekdayAverages(sessions);
  const categories = WEEKDAY_DISPLAY_ORDER[language].map((w) => ({
    label: labels[w],
    value: averages[w].averageSeconds,
  }));

  el.weekdayChart.innerHTML = renderCategoryBarChart(categories, { gap: 8 }) || EMPTY;
}

/* ---------- session quality ---------- */

export function renderSessionLengthChart(sessions) {
  if (!el.sessionLengthChart) return;

  const labels = SESSION_LENGTH_LABELS[lang()];
  const categories = buildSessionLengthDistribution(sessions).map((d, i) => ({
    label: labels[i],
    value: d.count,
  }));

  el.sessionLengthChart.innerHTML =
    renderCategoryBarChart(categories, {
      gap: 24,
      formatValue: (v) => String(Math.round(v)),
      formatTooltip: (c) => `${c.label}: ${c.value}`,
    }) || EMPTY;
}

export function renderOutcomeDonut(stats) {
  if (!el.donutChart) return;

  const t = tr();
  const segments = [
    { value: stats.completedSessions, className: 'chart-donut-segment--completed', label: t.completedLabel },
    { value: stats.abandonedSessions, className: 'chart-donut-segment--abandoned', label: t.abandonedLabel },
    { value: stats.cancelledSessions, className: 'chart-donut-segment--cancelled', label: t.cancelledLabel },
  ];

  el.donutChart.innerHTML = renderDonutChart(segments) || EMPTY;
  el.donutLegend.innerHTML = segments
    .map((seg) => swatch(seg.className, `${seg.label} · ${seg.value}`))
    .join('');
}

export function renderPauseDonut(stats) {
  if (!el.pauseDonutChart) return;

  const t = tr();
  const segments = [
    { value: stats.totalStudySeconds, label: t.studyLabel, className: 'chart-donut-segment--study' },
    { value: stats.totalBreakSeconds, label: t.breakTime, className: 'chart-donut-segment--break' },
    { value: stats.totalPausedSeconds, label: t.pausedLabel, className: 'chart-donut-segment--paused' },
  ];
  const total = segments.reduce((sum, seg) => sum + seg.value, 0);

  el.pauseDonutChart.innerHTML = renderDonutChart(segments) || EMPTY;
  el.pauseDonutLegend.innerHTML = segments
    .filter((seg) => seg.value > 0)
    .map((seg) => {
      const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0;
      return swatch(seg.className, `${esc(seg.label)} · ${pct}%`);
    })
    .join('');
}
