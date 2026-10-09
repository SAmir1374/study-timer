/* =============================================================
   ui/planData.js — derived data from the weekly plan (Schema v4/v5)
   and recorded sessions. No DOM access here.

   Plan:  phases[] → weeks[] → days[] → sessions[]
   ============================================================= */

import { state, tr, todayKey, getDaySessions } from '../state.js';
import { WeeklyPlanStore } from '../weeklyPlanStore.js';
import { DAY_MS, ENGLISH_SUBJECT, saturdayWeekRange, utcMs } from './utils.js';

/* ---------- minutes ---------- */

export function sumPlannedMinutes(day) {
  const sessions = Array.isArray(day?.sessions) ? day.sessions : [];
  return sessions.reduce((sum, s) => sum + (Number(s?.minutes) || 0), 0);
}

/** Active (non-break) minutes in a list of recorded sessions. */
export function activeMinutes(records) {
  return records.reduce((total, rec) => {
    if (!rec || rec.type === 'break') return total;
    return total + (Number(rec.derived?.activeDurationSeconds) || 0) / 60;
  }, 0);
}

/** Actual recorded minutes (everything except breaks). NOT the plan target. */
export const getActualMinutesForDate = (dateKey) => activeMinutes(getDaySessions(dateKey));

/** Only study + review minutes (used by the day modal). */
export function getActualMinutesForModalDay(dateKey) {
  return getDaySessions(dateKey).reduce((sum, rec) => {
    if (rec?.type !== 'study' && rec?.type !== 'review') return sum;
    return sum + (Number(rec?.derived?.activeDurationSeconds) || 0) / 60;
  }, 0);
}

export function getDayStatus(dateKey, actualMinutes, today) {
  if (dateKey > today) return 'future';
  if (dateKey === today) return 'today';
  return actualMinutes > 0 ? 'partial' : 'missed';
}

/* ---------- plan lookups ---------- */

/** Plan start/end/weeks detected from the weekly plan (when Settings has none). */
export function getPlanDatesFromWeeklyPlan() {
  try {
    const weeks = WeeklyPlanStore.getWeeks();
    if (!weeks.length) return null;

    let minDate = null;
    let maxDate = null;

    for (const week of weeks) {
      const s = week?.startDate;
      const e = week?.endDate;
      if (s && (!minDate || s < minDate)) minDate = s;
      if (e && (!maxDate || e > maxDate)) maxDate = e;
    }

    if (!minDate || !maxDate) return null;

    const days = Math.round((utcMs(maxDate) - utcMs(minDate)) / DAY_MS);
    const totalWeeks = Math.max(1, Math.ceil((days + 1) / 7));

    return { startDate: minDate, examDate: maxDate, totalWeeks };
  } catch (err) {
    console.warn('Could not detect plan dates from weekly plan:', err);
    return null;
  }
}

/** Map<"YYYY-MM-DD", { day, planWeek }> — first occurrence wins on duplicates. */
function getWeeklyPlanDaysByDate() {
  const daysByDate = new Map();

  for (const planWeek of WeeklyPlanStore.getWeeks()) {
    const days = Array.isArray(planWeek?.days) ? planWeek.days : [];
    for (const day of days) {
      if (day?.date && !daysByDate.has(day.date)) {
        daysByDate.set(day.date, { day, planWeek });
      }
    }
  }

  return daysByDate;
}

/** Map<date, plannedMinutes> */
export function getPlannedMinutesByDate() {
  const planned = new Map();
  try {
    for (const week of WeeklyPlanStore.getWeeks()) {
      const days = Array.isArray(week?.days) ? week.days : [];
      for (const day of days) {
        if (day?.date) planned.set(day.date, sumPlannedMinutes(day));
      }
    }
  } catch (err) {
    console.warn('Could not read weekly plan:', err);
  }
  return planned;
}

/** { day, week } for a date, or null. */
export function getWeeklyPlanDayContext(dateKey) {
  for (const week of WeeklyPlanStore.getWeeks()) {
    const days = Array.isArray(week?.days) ? week.days : [];
    const day = days.find((item) => item?.date === dateKey);
    if (day) return { day, week };
  }
  return null;
}

/**
 * Re-groups plan days into the Saturday..Friday weeks shown by the UI
 * (the master plan itself may use a different week boundary).
 */
export function buildWeeklyPlanDisplayWeeks() {
  const weeksByStart = new Map();

  for (const { day, planWeek } of getWeeklyPlanDaysByDate().values()) {
    const range = saturdayWeekRange(day.date);

    if (!weeksByStart.has(range.start)) {
      weeksByStart.set(range.start, { start: range.start, end: range.end, entries: [] });
    }
    weeksByStart.get(range.start).entries.push({ day, planWeek });
  }

  return [...weeksByStart.values()].sort((a, b) => a.start.localeCompare(b.start));
}

/** Unique master-plan weeks represented inside a display week. */
export function getUniqueSourceWeeks(entries) {
  const map = new Map();
  for (const { planWeek } of entries) {
    if (planWeek?.id && !map.has(planWeek.id)) map.set(planWeek.id, planWeek);
  }
  return [...map.values()];
}

/** Sort entries Saturday → Friday. */
export function sortPlanDays(entries) {
  const rankOf = (weekday) => (Number(weekday) + 1) % 7;

  return entries.slice().sort((a, b) => {
    const diff = rankOf(a.day.weekday) - rankOf(b.day.weekday);
    return diff || a.day.date.localeCompare(b.day.date);
  });
}

/**
 * Today's goal in minutes, from today's planned sessions.
 * Falls back to the application-level daily goal (default 4h).
 */
export function getEffectiveDailyGoalMinutes() {
  try {
    const today = todayKey();

    for (const week of WeeklyPlanStore.getWeeks()) {
      const days = Array.isArray(week.days) ? week.days : [];
      const todayDay = days.find((d) => d && d.date === today);
      if (!todayDay) continue;

      const total = sumPlannedMinutes(todayDay);
      if (total > 0) return total;
      break; // today exists but has no sessions → use fallback
    }
  } catch (err) {
    console.warn('Could not read weekly plan for today:', err);
  }

  return state.doc.studyPlan.dailyGoalMinutes || 240;
}

/* ---------- summaries ---------- */

/** Summary of a planned day (from day.sessions[]). */
export function computeDaySummary(day) {
  const sessions = Array.isArray(day?.sessions) ? day.sessions : [];
  const totals = { total: 0, english: 0, study: 0, practice: 0, test: 0, analysis: 0, review: 0 };
  const subjects = new Map();

  for (const s of sessions) {
    if (!s || typeof s !== 'object') continue;
    const m = Number(s.minutes) || 0;
    totals.total += m;
    if (s.subject === ENGLISH_SUBJECT) totals.english += m;
    if (totals[s.type] !== undefined) totals[s.type] += m;
    if (s.subject) subjects.set(s.subject, (subjects.get(s.subject) || 0) + m);
  }

  const first = sessions.find((s) => s && s.subject && s.topic);
  const focus = first
    ? `${first.subject}: ${first.topic}`
    : sessions.length
      ? `${sessions.length} جلسه`
      : 'بدون جلسه';

  return {
    ...totals,
    focus,
    sessionCount: sessions.length,
    subjects: [...subjects.entries()].sort((a, b) => b[1] - a[1]),
  };
}

/** Map<subject, { planned, actual, pct }> — planned vs. actual minutes. */
export function computeSubjectCompletion(day, daySessions = []) {
  const planned = new Map();
  for (const s of Array.isArray(day?.sessions) ? day.sessions : []) {
    if (!s?.subject) continue;
    planned.set(s.subject, (planned.get(s.subject) || 0) + (Number(s.minutes) || 0));
  }

  const actual = new Map();
  for (const s of daySessions) {
    if (!s || s.type === 'break' || !s.subject) continue;
    const minutes = (Number(s.derived?.activeDurationSeconds) || 0) / 60;
    actual.set(s.subject, (actual.get(s.subject) || 0) + minutes);
  }

  const result = new Map();
  for (const [subject, plannedMin] of planned) {
    const actualMin = actual.get(subject) || 0;
    const pct = plannedMin > 0 ? Math.min(100, Math.round((actualMin / plannedMin) * 100)) : 0;
    result.set(subject, { planned: plannedMin, actual: actualMin, pct });
  }
  return result;
}

/** One-line summary of a test-analysis session (null for other types). */
export function formatAnalysisSummary(rec) {
  if (rec.type !== 'analysis') return null;

  const t = tr();
  const a = rec.analysis || {};
  const has = (v) => v !== null && v !== undefined;
  const parts = [];

  if (rec.topic) parts.push(rec.topic);
  if (has(a.testCount)) parts.push(`${t.analysisTestCount}: ${a.testCount}`);
  if (has(a.correctPercent)) parts.push(`${t.analysisCorrectPercent}: ${a.correctPercent}%`);
  if (has(a.analyzedErrorCount)) parts.push(`${t.analysisErrorCount}: ${a.analyzedErrorCount}`);

  return parts.length ? parts.join(' · ') : null;
}
