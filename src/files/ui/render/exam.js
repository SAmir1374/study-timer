/* Exam countdown card. */

import { tr, todayKey, clamp, getExamProgress, getTodaySummary } from '../../state.js';
import { fmtHoursMinutes } from '../../timer.js';
import { el } from '../elements.js';
import { getPlanDatesFromWeeklyPlan } from '../planData.js';
import { DAY_MS, utcMs } from '../utils.js';
import { setText } from './textCache.js';

/** Builds a progress object from plain dates (used when Settings has none). */
function progressFromDates({ startDate, examDate, totalWeeks }) {
  const startMs = utcMs(startDate);
  const endMs = utcMs(examDate);
  const todayMs = utcMs(todayKey());

  const totalDays = Math.max(1, Math.round((endMs - startMs) / DAY_MS) + 1);
  const daysPassed = clamp(Math.round((todayMs - startMs) / DAY_MS) + 1, 0, totalDays);

  return {
    totalDays,
    daysPassed,
    daysLeft: Math.max(0, totalDays - daysPassed),
    currentWeek: Math.min(totalWeeks, Math.max(1, Math.ceil((daysPassed + 1) / 7))),
    totalWeeks,
    progressPercent: Math.round((daysPassed / totalDays) * 100),
  };
}

function resolveProgress() {
  const fromSettings = getExamProgress();
  if (fromSettings) return fromSettings;

  const detected = getPlanDatesFromWeeklyPlan();
  return detected ? progressFromDates(detected) : null;
}

export function exam() {
  const progress = resolveProgress();

  if (!progress) {
    el.examEmptyNote.hidden = false;
    [el.examDaysLeft, el.examDaysPassed, el.examWeekLabel, el.examDaysLeftMini].forEach((node) =>
      setText(node, '—')
    );
    el.examProgressFill.style.width = '0%';
    return;
  }

  const t = tr();
  el.examEmptyNote.hidden = true;

  setText(el.examDaysLeft, String(progress.daysLeft));
  setText(el.examDaysPassed, `${progress.daysPassed} ${t.daysPassed}`);
  setText(el.examWeekLabel, `${t.week} ${progress.currentWeek} / ${progress.totalWeeks}`);
  setText(el.examDaysLeftMini, `${progress.daysLeft} ${t.daysLeft}`);
  el.examProgressFill.style.width = `${progress.progressPercent}%`;

  if (el.dailyStatusValue) {
    setText(el.dailyStatusValue, fmtHoursMinutes(getTodaySummary().studySeconds));
  }
  if (el.weeklyStatusValue) {
    setText(el.weeklyStatusValue, `${t.week} ${progress.currentWeek}`);
  }
}
