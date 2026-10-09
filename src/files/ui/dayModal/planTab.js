/* Tab 2 — "Plan": the planned sessions of the day + its master-plan week. */

import { computeDaySummary } from '../planData.js';
import { escapeHtml, makeL } from '../utils.js';
import { dayStat, formatPlanMinutes, getDayModalStatusLabel } from './shared.js';

export function renderPlanTab(refs, ctx) {
  const { day, week, dateKey, status, language, today, actualMinutes } = ctx;
  const L = makeL(language);
  const fmt = (value) => formatPlanMinutes(value, language);
  const min = L('دقیقه', 'min');

  const summary = computeDaySummary(day);
  const sessions = Array.isArray(day?.sessions) ? day.sessions : [];

  const weekTarget = Math.max(0, Number(week?.targetMinutes) || 0);
  const weekTitle = week?.title || week?.id || L('هفته برنامه', 'Study week');
  const weekGoal = week?.goal || '';

  refs.planSummary.innerHTML = [
    dayStat(L('تعداد جلسات', 'Sessions'), String(sessions.length)),
    dayStat(L('مجموع برنامه', 'Planned minutes'), `${fmt(summary.total)} ${min}`),
    dayStat(L('زبان تخصصی', 'Specialized English'), `${fmt(summary.english)} ${min}`),
    dayStat(L('وضعیت روز', 'Day status'), getDayModalStatusLabel(status, language === 'fa')),
    dayStat(L('مطالعه ثبت‌شده', 'Recorded study'), `${fmt(actualMinutes)} ${min}`),
  ].join('');

  refs.planListLabel.textContent = L('جلسات برنامه‌ریزی‌شده', 'Planned sessions');

  refs.planSessions.innerHTML = sessions.length
    ? sessions
        .map(
          (s) => `
      <div class="weekly-plan-session">
        <div class="weekly-plan-session__main">
          <span class="weekly-plan-session__time">${escapeHtml(s.startTime)}–${escapeHtml(s.endTime)}</span>
          <span class="weekly-plan-session__subject">${escapeHtml(s.subject)} — ${escapeHtml(s.topic)}</span>
        </div>
        <span class="weekly-plan-session__minutes">${escapeHtml(s.minutes)}${L('د', 'm')}</span>
      </div>`
        )
        .join('')
    : `<div class="empty-state">${L(
        'برای این روز جلسه‌ای برنامه‌ریزی نشده است.',
        'No sessions planned for this day.'
      )}</div>`;

  refs.planNote.hidden = !weekGoal;
  refs.planNote.textContent = weekGoal;

  refs.planMix.innerHTML = `
    <div class="section-label">${L('هفته‌ی برنامه', 'Study week')}</div>
    <div class="day-modal__summary">
      ${dayStat(L('هفته', 'Week'), escapeHtml(weekTitle))}
      ${weekTarget > 0 ? dayStat(L('هدف هفتگی', 'Weekly target'), `${fmt(weekTarget)} ${min}`) : ''}
      ${weekGoal ? dayStat(L('هدف هفته', 'Week goal'), escapeHtml(weekGoal)) : ''}
    </div>
  `;

  // Hourly plan timeline is intentionally disabled in this version.
  refs.planClockLabel.textContent = L('برنامه روی ساعت شبانه‌روز', 'Plan on the clock');
  refs.planClockEmpty.hidden = false;
  refs.planClockEmpty.textContent = L(
    'برای هر جلسه ساعت شروع و پایان در برنامه تعریف شده است؛ اما نمایش timeline ساعتی در این نسخه فعال نیست.',
    'Each session has start/end times in the plan; hourly timeline display is not enabled in this version.'
  );
  refs.planScroll.hidden = true;
  refs.planTimeline.innerHTML = '';
  refs.planScroll.dataset.focus = String(dateKey === today ? new Date().getHours() * 60 : 6 * 60);
}
