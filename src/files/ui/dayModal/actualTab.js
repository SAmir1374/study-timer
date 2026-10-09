/* Tab 1 — "Recorded": sessions placed on a 24h timeline. */

import { tr } from '../../state.js';
import { fmtHoursMinutes, fmtClock } from '../../timer.js';
import { fromIso } from '../../dataLayer.js';
import { escapeHtml, kindLabelOf, makeL } from '../utils.js';
import {
  DAY_HOUR_PX,
  dayStat,
  getDayBlocks,
  getDayModalStatusLabel,
  isWorkRecord,
} from './shared.js';

function timelineHtml(blocksMarkup, dateKey, today) {
  const hourRows = Array.from(
    { length: 24 },
    (_, h) => `
      <div class="day-timeline__hour" style="top:${h * DAY_HOUR_PX}px;height:${DAY_HOUR_PX}px">
        <span class="day-timeline__hour-label">${String(h).padStart(2, '0')}:00</span>
      </div>`
  ).join('');

  let nowLine = '';
  if (dateKey === today) {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    nowLine = `<div class="day-timeline__now" style="top:${(nowMin / 60) * DAY_HOUR_PX}px"></div>`;
  }

  return `${hourRows}<div class="day-timeline__track">${blocksMarkup}</div>${nowLine}`;
}

function blockHtml({ rec, startMin, endMin }, t) {
  const kind = rec.type;
  const top = (startMin / 60) * DAY_HOUR_PX;
  const height = Math.max(18, ((endMin - startMin) / 60) * DAY_HOUR_PX);
  const compact = height < 34;

  const range = `${fmtClock(fromIso(rec.actual.startedAt))}–${fmtClock(fromIso(rec.actual.endedAt))}`;
  const duration = fmtHoursMinutes(rec.derived.activeDurationSeconds);
  const name = kind === 'break' ? t.break : `${rec.subject || t.noSubject} · ${kindLabelOf(kind, t)}`;
  const extra = kind === 'break' ? '' : rec.topic || '';
  const tooltip = [name, range, duration, extra].filter(Boolean).join(' · ');

  return `
    <div class="day-block kc-${kind}${compact ? ' day-block--compact' : ''}" style="top:${top}px;height:${height}px" title="${escapeHtml(tooltip)}">
      <span class="day-block__name">${escapeHtml(name)}</span>
      ${compact ? '' : `<span class="day-block__meta">${range} · ${duration}</span>`}
      ${compact || !extra ? '' : `<span class="day-block__topic">${escapeHtml(extra)}</span>`}
    </div>`;
}

export function renderActualTab(refs, ctx) {
  const { dateKey, status, language, today, actualMinutes } = ctx;
  const L = makeL(language);
  const t = tr();

  const blocks = getDayBlocks(dateKey);
  const sessionCount = blocks.filter(({ rec }) => isWorkRecord(rec)).length;

  refs.summary.dataset.status = status;
  refs.summary.innerHTML = [
    dayStat(L('زمان مطالعه', 'Focus time'), fmtHoursMinutes(Math.round(actualMinutes) * 60)),
    dayStat(L('تعداد جلسه', 'Sessions'), String(sessionCount)),
    dayStat(L('وضعیت', 'Status'), getDayModalStatusLabel(status, language === 'fa')),
  ].join('');

  refs.timelineLabel.textContent = L(
    'ساعت شبانه‌روز · جلسه‌های ثبت‌شده',
    'Time of day · recorded sessions'
  );

  refs.timeline.style.height = `${24 * DAY_HOUR_PX}px`;
  refs.timeline.innerHTML = timelineHtml(
    blocks.map((block) => blockHtml(block, t)).join(''),
    dateKey,
    today
  );

  refs.timelineEmpty.hidden = blocks.length > 0;
  refs.timelineEmpty.textContent =
    dateKey > today
      ? L(
          'این روز هنوز نرسیده؛ جزئیات برنامه را در تب «برنامه» ببینید.',
          "This day hasn't happened yet — see the Plan tab."
        )
      : L('برای این روز جلسه‌ای ثبت نشده است.', 'No sessions were recorded for this day.');

  const kindsUsed = [...new Set(blocks.map(({ rec }) => rec.type))];
  refs.legend.innerHTML = kindsUsed
    .map(
      (kind) =>
        `<span class="day-legend__item kc-${kind}"><i class="day-legend__dot"></i>${kindLabelOf(kind, t)}</span>`
    )
    .join('');

  // Where the timeline should scroll to when opened.
  let focusMin = 6 * 60;
  if (blocks.length) focusMin = Math.min(...blocks.map((b) => b.startMin));
  else if (dateKey === today) focusMin = new Date().getHours() * 60;
  refs.scroll.dataset.focus = String(focusMin);
}
