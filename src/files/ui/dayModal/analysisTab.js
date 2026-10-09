/* Tab 3 — "Analysis": KPIs, subject bars, activity donut, hourly focus, test results. */

import { tr, getDaySessions } from '../../state.js';
import { fmtHoursMinutes, fmtClock } from '../../timer.js';
import { fromIso } from '../../dataLayer.js';
import { escapeHtml, kindLabelOf, makeL } from '../utils.js';
import { dayStat, formatPlanMinutes, getDayBlocks, isWorkRecord, activeSeconds } from './shared.js';

const toMs = (iso) => new Date(fromIso(iso)).getTime();

/* ---------- calculations ---------- */

/** Focus minutes per hour of day (24 buckets), weighting by active/elapsed ratio. */
function computeHourlyFocus(dateKey) {
  const hours = Array(24).fill(0);

  getDayBlocks(dateKey).forEach(({ rec, startMin, endMin }) => {
    if (!isWorkRecord(rec)) return;

    const span = endMin - startMin;
    const ratio = span > 0 ? Math.min(1, activeSeconds(rec) / 60 / span) : 0;

    for (let h = Math.floor(startMin / 60); h <= Math.floor((endMin - 0.001) / 60); h += 1) {
      const overlap = Math.min(endMin, (h + 1) * 60) - Math.max(startMin, h * 60);
      if (overlap > 0) hours[h] += overlap * ratio;
    }
  });

  return hours;
}

/* ---------- html sections ---------- */

function subjectBarsHtml(work, focusSec, t, L) {
  const totals = new Map();
  work.forEach((rec) => {
    const subject = rec.subject || t.noSubject;
    totals.set(subject, (totals.get(subject) || 0) + activeSeconds(rec) / 60);
  });

  const rows = [...totals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(
      ([subject, minutes]) => `
        <div class="day-bar-row">
          <div class="day-bar-row__head">
            <span>${escapeHtml(subject)}</span>
            <span class="day-bar-row__nums">${Math.round(minutes)} ${L('دقیقه', 'min')}</span>
          </div>
          <div class="day-bar">
            <span class="day-bar__actual kc-study" style="width:${focusSec > 0 ? ((minutes * 60) / focusSec) * 100 : 0}%"></span>
          </div>
        </div>`
    )
    .join('');

  return rows
    ? `<div class="section-label">${L('زمان مطالعه به تفکیک درس', 'Study time by subject')}</div>
       <div class="day-bar-list">${rows}</div>`
    : '';
}

function donutHtml(recs, t, L) {
  const kindTotals = { study: 0, practice: 0, test: 0, analysis: 0, review: 0, break: 0 };
  recs.forEach((rec) => {
    kindTotals[rec.type] = (kindTotals[rec.type] || 0) + activeSeconds(rec);
  });

  const totalSec = Object.values(kindTotals).reduce((sum, v) => sum + v, 0) || 1;
  const nonEmpty = Object.entries(kindTotals).filter(([, seconds]) => seconds > 0);

  let accumulated = 0;
  const segments = nonEmpty
    .map(([kind, seconds]) => {
      const percent = (seconds / totalSec) * 100;
      const circle = `<circle class="day-donut__seg kc-${kind}" cx="21" cy="21" r="15.9155" fill="none" stroke-width="5" stroke-dasharray="${percent} ${100 - percent}" stroke-dashoffset="${25 - accumulated}"></circle>`;
      accumulated += percent;
      return circle;
    })
    .join('');

  const legend = nonEmpty
    .map(
      ([kind, seconds]) => `
        <div class="day-donut__legend-row kc-${kind}">
          <i class="day-legend__dot"></i>
          <span class="day-donut__legend-name">${kindLabelOf(kind, t)}</span>
          <span class="day-donut__legend-val">${fmtHoursMinutes(seconds)} · ${Math.round((seconds / totalSec) * 100)}%</span>
        </div>`
    )
    .join('');

  return `
    <div class="section-label">${L('زمان به تفکیک نوع فعالیت', 'Time by activity')}</div>
    <div class="day-donut">
      <svg class="day-donut__svg" viewBox="0 0 42 42" role="img" aria-label="${L('نمودار حلقه‌ای', 'Donut chart')}">
        <circle class="day-donut__track" cx="21" cy="21" r="15.9155" fill="none" stroke-width="5"></circle>
        ${segments}
        <text x="21" y="21" text-anchor="middle" dominant-baseline="central" class="day-donut__total">${fmtHoursMinutes(totalSec)}</text>
      </svg>
      <div class="day-donut__legend">${legend}</div>
    </div>`;
}

function hourlyChartHtml(hours, maxHour, peakHour, L) {
  const cols = hours
    .map((minutes, hour) => {
      const label = String(hour).padStart(2, '0');
      return `
        <div class="day-hours__col${hour === peakHour ? ' is-peak' : ''}" title="${label}:00 · ${Math.round(minutes)} ${L('دقیقه', 'min')}">
          <div class="day-hours__area">
            <span class="day-hours__bar" style="height:${maxHour ? (minutes / maxHour) * 100 : 0}%"></span>
          </div>
          <span class="day-hours__tick">${hour % 3 === 0 ? label : ''}</span>
        </div>`;
    })
    .join('');

  return `
    <div class="section-label">${L('تمرکز در هر ساعت از شبانه‌روز', 'Focus by hour of day')}</div>
    <div class="day-hours" role="img" aria-label="${L('نمودار میله‌ای ساعتی', 'Hourly bar chart')}">${cols}</div>`;
}

function testResultsHtml(recs, t, L) {
  const has = (v) => v !== null && v !== undefined;

  const rows = recs.filter((rec) => {
    if (rec.type !== 'analysis') return false;
    const a = rec.analysis || {};
    return [a.testCount, a.correctPercent, a.analyzedErrorCount].some(has);
  });
  if (!rows.length) return '';

  const valueOrDash = (value, suffix = '') => (has(value) ? `${value}${suffix}` : '—');

  const weighted = rows.filter(
    (rec) => Number(rec.analysis?.testCount) > 0 && has(rec.analysis?.correctPercent)
  );
  const totalQuestions = weighted.reduce((sum, rec) => sum + Number(rec.analysis.testCount || 0), 0);
  const averageCorrect = totalQuestions
    ? weighted.reduce(
        (sum, rec) =>
          sum + Number(rec.analysis.testCount || 0) * Number(rec.analysis.correctPercent || 0),
        0
      ) / totalQuestions
    : null;

  const body = rows
    .map(
      (rec) => `
        <tr>
          <td>${escapeHtml([rec.subject, rec.topic].filter(Boolean).join(' · ') || t.noSubject)}</td>
          <td>${valueOrDash(rec.analysis?.testCount)}</td>
          <td>${valueOrDash(rec.analysis?.correctPercent, '%')}</td>
          <td>${valueOrDash(rec.analysis?.analyzedErrorCount)}</td>
        </tr>`
    )
    .join('');

  return `
    <div class="section-label">${L('نتایج تحلیل آزمون', 'Test analysis results')}</div>
    <div class="day-table__wrap">
      <table class="day-table">
        <thead>
          <tr>
            <th>${L('درس / مبحث', 'Subject / topic')}</th>
            <th>${L('تعداد تست', 'Questions')}</th>
            <th>${L('درصد صحیح', 'Correct')}</th>
            <th>${L('خطاها', 'Errors')}</th>
          </tr>
        </thead>
        <tbody>${body}</tbody>
      </table>
    </div>
    ${
      averageCorrect !== null
        ? `<p class="settings-hint">${L('میانگین وزنی درصد صحیح', 'Weighted average correct')}: <strong>${Math.round(averageCorrect * 10) / 10}%</strong> (${totalQuestions} ${L('تست', 'questions')})</p>`
        : ''
    }`;
}

function topicsHtml(work, L) {
  const topics = [...new Set(work.map((rec) => rec.topic).filter(Boolean))];
  if (!topics.length) return '';

  return `
    <div class="section-label">${L('مباحث خوانده‌شده', 'Topics covered')}</div>
    <div class="day-chips">
      ${topics.map((topic) => `<span class="day-chip">${escapeHtml(topic)}</span>`).join('')}
    </div>`;
}

function emptyHtml({ dateKey, today, day, week, language }, L) {
  const message =
    dateKey > today
      ? L(
          'این روز هنوز نرسیده؛ بعد از ثبت جلسه‌ها تحلیل اینجا نمایش داده می‌شود.',
          "This day hasn't happened yet — analysis will appear after sessions are recorded."
        )
      : L('برای این روز داده‌ای برای تحلیل ثبت نشده است.', 'No recorded data is available for this day.');

  return `
    <div class="empty-state">${message}</div>
    <div class="day-modal__summary">
      ${dayStat(L('تمرکز برنامه', 'Planned focus'), escapeHtml(day?.focus || '—'))}
      ${dayStat(L('هدف هفتگی', 'Weekly target'), `${formatPlanMinutes(week?.targetMinutes, language)} ${L('دقیقه', 'min')}`)}
    </div>`;
}

/* ---------- tab ---------- */

export function renderAnalysisTab(refs, ctx) {
  const { dateKey, day, language } = ctx;
  const L = makeL(language);
  const t = tr();

  const recs = getDaySessionsWithTimes(dateKey);
  if (!recs.length) {
    refs.analysisBody.innerHTML = emptyHtml(ctx, L);
    return;
  }

  const work = recs.filter(isWorkRecord);
  const focusSec = work.reduce((sum, rec) => sum + activeSeconds(rec), 0);
  const breakSec = recs.filter((r) => r.type === 'break').reduce((sum, r) => sum + activeSeconds(r), 0);
  const longestSec = Math.max(0, ...work.map(activeSeconds));
  const avgSec = work.length ? focusSec / work.length : 0;
  const firstMs = Math.min(...recs.map((r) => toMs(r.actual.startedAt)));
  const lastMs = Math.max(...recs.map((r) => toMs(r.actual.endedAt)));

  const hours = computeHourlyFocus(dateKey);
  const maxHour = Math.max(...hours);
  const peakHour = maxHour > 0 ? hours.indexOf(maxHour) : -1;

  const kpis = [
    dayStat(L('زمان مطالعه', 'Focus time'), fmtHoursMinutes(focusSec)),
    dayStat(L('تعداد جلسه', 'Sessions'), String(work.length)),
    dayStat(L('میانگین هر جلسه', 'Avg session'), fmtHoursMinutes(avgSec)),
    dayStat(L('طولانی‌ترین جلسه', 'Longest session'), fmtHoursMinutes(longestSec)),
    dayStat(L('استراحت', 'Breaks'), fmtHoursMinutes(breakSec)),
    dayStat(L('بازه‌ی فعالیت', 'Active window'), `${fmtClock(firstMs)}–${fmtClock(lastMs)}`),
    peakHour >= 0
      ? dayStat(L('پرتمرکزترین ساعت', 'Peak hour'), `${String(peakHour).padStart(2, '0')}:00`)
      : '',
    dayStat(L('تمرکز برنامه', 'Planned focus'), escapeHtml(day?.focus || '—')),
  ].join('');

  refs.analysisBody.innerHTML = `
    <div class="day-modal__summary">${kpis}</div>
    ${subjectBarsHtml(work, focusSec, t, L)}
    ${donutHtml(recs, t, L)}
    ${hourlyChartHtml(hours, maxHour, peakHour, L)}
    ${testResultsHtml(recs, t, L)}
    ${topicsHtml(work, L)}
  `;
}


/** Sessions that have the timing + derived data the analysis needs. */
function getDaySessionsWithTimes(dateKey) {
  return getDaySessions(dateKey).filter(
    (rec) => rec?.actual?.startedAt && rec?.actual?.endedAt && rec?.derived
  );
}
