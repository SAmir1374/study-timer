/* KPI card grid. */

import { fmtHoursMinutes } from '../../../timer.js';
import { el } from '../elements.js';
import { DAILY_WINDOW_DAYS } from '../constants.js';
import { dayLabel } from '../format.js';

function kpiCard(icon, label, value, meta) {
  const card = document.createElement('div');
  card.className = 'analytics-kpi';
  card.innerHTML = `
    <div class="analytics-kpi__icon">${icon}</div>
    <div class="analytics-kpi__body">
      <span class="analytics-kpi__label">${label}</span>
      <strong class="analytics-kpi__value">${value}</strong>
      ${meta ? `<span class="analytics-kpi__meta">${meta}</span>` : ''}
    </div>
  `;
  return card;
}

export function renderKpis({ stats, streaks, goalSeconds, avgSeconds, rate, goalDays, best }) {
  if (!el.kpiGrid) return;

  const hasBest = best && best.studySeconds > 0;
  const breakShare = Math.round(
    (stats.totalBreakSeconds / Math.max(1, stats.totalStudySeconds + stats.totalBreakSeconds)) * 100
  );

  const cards = [
    kpiCard('⏱️', 'کل زمان مطالعه', fmtHoursMinutes(stats.totalStudySeconds), `${stats.totalSessions} جلسه`),
    kpiCard('🔥', 'Streak فعلی', `${streaks.current} روز`, `بلندترین: ${streaks.longest} روز`),
    kpiCard(
      '✅',
      'نرخ تکمیل',
      rate === null ? '—' : `${rate}%`,
      `${stats.completedSessions} کامل · ${stats.abandonedSessions} ناتمام`
    ),
    kpiCard(
      '⏳',
      'میانگین جلسه',
      avgSeconds > 0 ? fmtHoursMinutes(avgSeconds) : '—',
      `${stats.totalSessions} جلسه`
    ),
    kpiCard(
      '🎯',
      `روزهای هدف (${DAILY_WINDOW_DAYS} روز)`,
      goalSeconds > 0 ? `${goalDays}/${DAILY_WINDOW_DAYS}` : '—',
      goalSeconds > 0 ? `هدف: ${fmtHoursMinutes(goalSeconds)}` : 'هدفی تعیین نشده'
    ),
    kpiCard(
      '🏆',
      `بهترین روز (${DAILY_WINDOW_DAYS} روز)`,
      hasBest ? fmtHoursMinutes(best.studySeconds) : '—',
      hasBest ? dayLabel(best.dayKey) : '—'
    ),
    kpiCard('☕', 'زمان استراحت', fmtHoursMinutes(stats.totalBreakSeconds), `${breakShare}% از کل`),
    kpiCard('🧘', 'زمان مکث', fmtHoursMinutes(stats.totalPausedSeconds), `${stats.totalPauseCount} بار`),
  ];

  el.kpiGrid.replaceChildren(...cards);
}
