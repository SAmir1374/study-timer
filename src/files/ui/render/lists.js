/* Today's subject breakdown, timeline bar and history list. */

import { tr, todayKey, getDaySessions, getTodaySubjectBreakdown } from '../../state.js';
import { fmtHoursMinutes, fmtClock } from '../../timer.js';
import { fromIso } from '../../dataLayer.js';
import { el } from '../elements.js';
import { formatAnalysisSummary } from '../planData.js';
import { SPECIAL_KINDS, kindShortLabel } from '../utils.js';

const activeSeconds = (rec) => Number(rec?.derived?.activeDurationSeconds) || 0;

const modifier = (base, kind) => (SPECIAL_KINDS.includes(kind) ? ` ${base}--${kind}` : '');

function makeSpan(className, text) {
  const span = document.createElement('span');
  span.className = className;
  span.textContent = text;
  return span;
}

/* ---------- subject breakdown ---------- */

/** Per-(subject, kind) totals. The same subject can appear twice (study + practice). */
export function todaySubjects() {
  if (!el.subjectBreakdown) return;

  const t = tr();
  const items = getTodaySubjectBreakdown();

  el.subjectBreakdown.querySelectorAll('.subject-breakdown-item').forEach((n) => n.remove());

  el.subjectBreakdownEmpty.hidden = items.length > 0;
  if (!items.length) return;

  items.forEach((item) => {
    const suffix = kindShortLabel(item.kind, t);

    const row = document.createElement('div');
    row.className = 'subject-breakdown-item' + modifier('subject-breakdown-item', item.kind);

    row.appendChild(
      makeSpan(
        'subject-breakdown-item__label',
        suffix ? `${item.subject} · ${suffix}` : item.subject
      )
    );
    row.appendChild(
      makeSpan('subject-breakdown-item__value', fmtHoursMinutes(item.studySeconds))
    );

    el.subjectBreakdown.appendChild(row);
  });
}

/* ---------- timeline ---------- */

function timelineTooltip(rec, t) {
  if (rec.type === 'break') return t.break;

  const parts = [rec.subject, kindShortLabel(rec.type, t), rec.topic];
  if (rec.type === 'analysis') parts.push(formatAnalysisSummary(rec));

  return parts.filter(Boolean).join(' · ');
}

export function timeline() {
  const t = tr();
  const items = getDaySessions(todayKey());

  el.timeline.querySelectorAll('.timeline-item').forEach((n) => n.remove());

  el.timelineEmpty.hidden = items.length > 0;
  if (!items.length) return;

  const maxDur = Math.max(...items.map(activeSeconds), 1);

  items.forEach((rec) => {
    const row = document.createElement('div');
    row.className = 'timeline-item';
    row.title = timelineTooltip(rec, t);

    const bar = document.createElement('span');
    bar.className =
      'timeline-item__bar' +
      (rec.type === 'break' ? ' timeline-item__bar--break' : '') +
      modifier('timeline-item__bar', rec.type);
    bar.style.flexGrow = String(Math.max(0.15, activeSeconds(rec) / maxDur));
    bar.style.flexBasis = '0';

    const range = `${fmtClock(fromIso(rec.actual.startedAt))}–${fmtClock(fromIso(rec.actual.endedAt))}`;

    row.appendChild(bar);
    row.appendChild(makeSpan('timeline-item__label', range));
    el.timeline.appendChild(row);
  });
}

/* ---------- history ---------- */

const HISTORY_TAG_CLASS = {
  practice: 'history-item__practice',
  test: 'history-item__test',
  analysis: 'history-item__analysis-tag',
  review: 'history-item__review',
};

function buildHistoryRow(rec, t) {
  const row = document.createElement('div');
  row.className = 'history-item';

  const left = makeSpan(
    'history-item__time',
    `${fmtClock(fromIso(rec.actual.startedAt))} – ${fmtClock(fromIso(rec.actual.endedAt))}`
  );

  if (rec.type === 'break') {
    left.appendChild(makeSpan('history-item__type', t.break));
  } else {
    const tagClass = HISTORY_TAG_CLASS[rec.type];
    if (tagClass) left.appendChild(makeSpan(tagClass, kindShortLabel(rec.type, t)));

    if (rec.type === 'study' && rec.isPractice) {
      left.appendChild(makeSpan('history-item__practice', t.practiceShort));
    }

    if (rec.subject) left.appendChild(makeSpan('history-item__subject', rec.subject));
  }

  row.appendChild(left);
  row.appendChild(makeSpan('history-item__duration', fmtHoursMinutes(activeSeconds(rec))));

  // Detail line: analysis metrics, or the topic.
  if (rec.type === 'analysis') {
    const detail = document.createElement('div');
    detail.className = 'history-item__analysis';
    detail.textContent = formatAnalysisSummary(rec) || t.noSubjectDataToday;
    row.appendChild(detail);
  } else if (rec.type !== 'break' && rec.topic) {
    const detail = document.createElement('div');
    detail.className = 'history-item__analysis';
    detail.textContent = rec.topic;
    row.appendChild(detail);
  }

  return row;
}

export function history() {
  const t = tr();
  const items = getDaySessions(todayKey()).slice().reverse();

  el.historyList.querySelectorAll('.history-item').forEach((n) => n.remove());

  el.historyEmpty.hidden = items.length > 0;
  items.forEach((rec) => el.historyList.appendChild(buildHistoryRow(rec, t)));
}
