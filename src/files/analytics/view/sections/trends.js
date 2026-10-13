/* Daily bars, weekly line (+ hint) and the monthly overview. */

import { fmtHoursMinutes } from '../../../timer.js';
import { renderBarChart, renderCategoryBarChart, renderLineChart } from '../../charts/index.js';
import { el } from '../elements.js';
import { monthLabel } from '../format.js';

const EMPTY = '<div class="chart-empty">—</div>';

export function renderDailyChart(daily, goalSeconds) {
  el.dailyChart.innerHTML = renderBarChart(daily, { goalSeconds }) || EMPTY;
}

export function renderWeeklyChart(weekly) {
  el.weeklyChart.innerHTML = renderLineChart(weekly) || EMPTY;

  if (el.weeklyChartHint) {
    const total = weekly.reduce((sum, b) => sum + b.studySeconds, 0);
    const avg = Math.round(total / weekly.length);
    el.weeklyChartHint.textContent = `میانگین: ${fmtHoursMinutes(avg)} در هفته`;
  }
}

/** Hidden when there is only one month of data. */
export function renderMonthlyChart(monthly) {
  if (!el.monthlySection) return;

  if (monthly.length <= 1) {
    el.monthlySection.hidden = true;
    return;
  }

  el.monthlySection.hidden = false;
  const categories = monthly.map((m) => ({ label: monthLabel(m.monthKey), value: m.studySeconds }));
  el.monthlyChart.innerHTML = renderCategoryBarChart(categories, { gap: 12 }) || EMPTY;
}
