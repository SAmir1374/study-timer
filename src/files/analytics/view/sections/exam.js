/* Exam countdown ring + status rows. */

import { fmtHoursMinutes } from '../../../timer.js';
import { esc } from '../../charts/index.js';
import { el } from '../elements.js';
import { tr } from '../prefs.js';

const RING_RADIUS = 46;

export function renderExamStatusAnalytics(status) {
  if (!el.analyticsExam) return;

  if (!status) {
    el.analyticsExam.innerHTML = `<div class="empty-state">${esc(tr().setExamDates)}</div>`;
    return;
  }

  const circ = 2 * Math.PI * RING_RADIUS;
  const offset = circ - (status.progressPct / 100) * circ;

  const weekText =
    status.currentWeek != null ? `${status.currentWeek} / ${status.totalWeeks}` : '—';

  const row = (label, value) => `
      <div class="analytics-exam__row">
        <span class="analytics-exam__row-label">${label}</span>
        <span class="analytics-exam__row-value">${value}</span>
      </div>`;

  el.analyticsExam.innerHTML = `
    <div class="analytics-exam__ring">
      <svg viewBox="0 0 110 110" class="hero-ring-svg">
        <circle class="hero-ring-bg" cx="55" cy="55" r="${RING_RADIUS}" fill="none" stroke-width="7"/>
        <circle class="hero-ring-fg" cx="55" cy="55" r="${RING_RADIUS}" fill="none" stroke-width="7"
          stroke-dasharray="${circ}" stroke-dashoffset="${offset}"
          transform="rotate(-90 55 55)" stroke-linecap="round"/>
      </svg>
      <div class="analytics-exam__ring-inner">
        <strong>${status.daysLeft}</strong>
        <span>روز مانده</span>
      </div>
    </div>
    <div class="analytics-exam__info">
      ${row('هفته‌ی فعلی', weekText)}
      ${row('روزهای گذشته', `${status.daysPassed} از ${status.totalPlanDays}`)}
      ${row('پیشرفت کلی', `${status.progressPct}%`)}
      ${row('مطالعه امروز', fmtHoursMinutes(status.todaySeconds))}
      ${row('این هفته', `${fmtHoursMinutes(status.weekSeconds)} / ${fmtHoursMinutes(status.weekGoalSeconds)}`)}
    </div>
  `;
}
