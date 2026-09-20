/* =============================================================
   analyticsData.js

   Pure aggregation over a parsed study-data.json document.
   No DOM, no storage — takes `sessions` (same shape as dataLayer.js
   session records) and returns plain data for analyticsCharts.js /
   analyticsApp.js to render. Never mutates its inputs.
   ============================================================= */

import {
  buildDailySummaries,
  isCountedSession,
  currentUtcOffsetMinutes,
  dateKeyOf,
  fromIso,
} from './dataLayer.js';

/* ------------------------------------------------------------
   Day-key arithmetic

   A local copy rather than importing state.js: analytics only ever
   works on a loaded document snapshot, never the live app state.
   ------------------------------------------------------------ */

function dayNumber(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

export function addDays(key, n) {
  const [y, m, d] = key.split('-').map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

export function daysBetween(fromKey, toKey) {
  return Math.round(dayNumber(toKey) - dayNumber(fromKey));
}

export function todayKey(nowMs = Date.now()) {
  return dateKeyOf(nowMs, currentUtcOffsetMinutes(nowMs));
}

/* ------------------------------------------------------------
   Overall (all-time) stats
   ------------------------------------------------------------ */

export function buildOverallStats(sessions) {
  const stats = {
    totalStudySeconds: 0,
    totalBreakSeconds: 0,
    totalPausedSeconds: 0,
    totalPauseCount: 0,
    totalSessions: 0, // counted study sessions (completed or abandoned, long enough to count)
    completedSessions: 0,
    abandonedSessions: 0,
    cancelledSessions: 0,
  };

  for (const rec of sessions) {
    if (rec.derived) {
      stats.totalPausedSeconds += rec.derived.totalPausedSeconds || 0;
      stats.totalPauseCount += rec.derived.pauseCount || 0;
    }

    if (rec.type === 'study') {
      if (isCountedSession(rec)) {
        stats.totalStudySeconds += rec.derived.activeDurationSeconds;
        stats.totalSessions += 1;
      }
      if (rec.status === 'completed') stats.completedSessions += 1;
      else if (rec.status === 'abandoned') stats.abandonedSessions += 1;
      else if (rec.status === 'cancelled') stats.cancelledSessions += 1;
    } else if (rec.type === 'break' && isCountedSession(rec)) {
      stats.totalBreakSeconds += rec.derived.activeDurationSeconds;
    }
  }

  return stats;
}

/**
 * Per-subject totals for the "Subjects" panel.
 * Every subject in `doc.subjects` is included, even ones with no
 * recorded study time yet (studySeconds: 0) — this is the lesson
 * list, not just a "what have I studied" breakdown. Sorted by study
 * time descending, so untouched subjects sink to the bottom while
 * keeping their original order among themselves.
 */
export function buildSubjectStats(sessions, subjects = []) {
  const map = new Map();

  for (const subject of subjects) {
    map.set(subject, {
      subject,
      studySeconds: 0,
      sessionCount: 0,
      completedSessions: 0,
      abandonedSessions: 0,
    });
  }

  for (const rec of sessions) {
    if (rec.type !== 'study' || !rec.subject || !isCountedSession(rec)) {
      continue;
    }

    if (!map.has(rec.subject)) {
      map.set(rec.subject, {
        subject: rec.subject,
        studySeconds: 0,
        sessionCount: 0,
        completedSessions: 0,
        abandonedSessions: 0,
      });
    }

    const item = map.get(rec.subject);

    item.studySeconds += rec.derived.activeDurationSeconds;
    item.sessionCount += 1;

    if (rec.status === 'completed') {
      item.completedSessions += 1;
    }

    if (rec.status === 'abandoned') {
      item.abandonedSessions += 1;
    }
  }

  return [...map.values()].sort((a, b) => b.studySeconds - a.studySeconds);
}

export function averageSessionSeconds(stats) {
  return stats.totalSessions > 0 ? Math.round(stats.totalStudySeconds / stats.totalSessions) : 0;
}

/** Percent of finished study sessions (completed vs abandoned) that reached their planned duration. Cancelled sessions are excluded — they were discarded, not "attempted". Null when there's nothing finished yet. */
export function completionRatePercent(stats) {
  const finished = stats.completedSessions + stats.abandonedSessions;
  return finished > 0 ? Math.round((stats.completedSessions / finished) * 100) : null;
}

/* ------------------------------------------------------------
   Daily / weekly series
   ------------------------------------------------------------ */

/** Daily study-seconds series for `days` calendar days ending today (inclusive), oldest first. */
export function buildDailySeries(sessions, days) {
  const summaries = buildDailySummaries(sessions);
  const end = todayKey();
  const series = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = addDays(end, -i);
    const s = summaries[key];
    series.push({
      dayKey: key,
      studySeconds: s ? s.studySeconds : 0,
      sessionCount: s ? s.sessionCount : 0,
    });
  }
  return series;
}

/** Rolling 7-day buckets, `weeks` buckets ending today, oldest first. */
export function buildWeeklySeries(sessions, weeks) {
  const daily = buildDailySeries(sessions, weeks * 7);
  const buckets = [];
  for (let w = 0; w < weeks; w++) {
    const slice = daily.slice(w * 7, w * 7 + 7);
    buckets.push({
      startKey: slice[0].dayKey,
      endKey: slice[slice.length - 1].dayKey,
      studySeconds: slice.reduce((sum, d) => sum + d.studySeconds, 0),
      sessionCount: slice.reduce((sum, d) => sum + d.sessionCount, 0),
    });
  }
  return buckets;
}

/** The best (highest study-time) day within a daily series. Null if the series is empty. */
export function bestDayOf(dailySeries) {
  return dailySeries.reduce(
    (best, d) => (d.studySeconds > (best ? best.studySeconds : -1) ? d : best),
    null
  );
}

/** How many days in the series met or exceeded the given per-day goal. */
export function goalDaysCount(dailySeries, goalSeconds) {
  if (!goalSeconds) return 0;
  return dailySeries.filter((d) => d.studySeconds >= goalSeconds).length;
}

/* ------------------------------------------------------------
   Streaks
   ------------------------------------------------------------ */

/** { current, longest } consecutive-day streaks of any study time, in whole days. */
export function buildStreaks(sessions) {
  const summaries = buildDailySummaries(sessions);
  const activeDays = Object.keys(summaries)
    .filter((k) => summaries[k].studySeconds > 0)
    .sort();

  let longest = 0;
  let run = 0;
  let prevKey = null;
  for (const key of activeDays) {
    run = prevKey && daysBetween(prevKey, key) === 1 ? run + 1 : 1;
    longest = Math.max(longest, run);
    prevKey = key;
  }

  let current = 0;
  let cursor = todayKey();
  while (summaries[cursor] && summaries[cursor].studySeconds > 0) {
    current += 1;
    cursor = addDays(cursor, -1);
  }

  return { current, longest };
}

/* ------------------------------------------------------------
   Exam plan status
   ------------------------------------------------------------ */

/**
 * Exam-plan progress derived from studyPlan + sessions.
 * Returns null when startDate/examDate haven't been set yet — the
 * caller should show the "set your dates" empty note in that case.
 */
export function buildExamPlanStatus(studyPlan, sessions) {
  const { startDate, examDate, totalWeeks, dailyGoalMinutes } = studyPlan || {};
  if (!startDate || !examDate) return null;

  const today = todayKey();
  const totalPlanDays = Math.max(1, daysBetween(startDate, examDate));
  const daysPassed = Math.min(totalPlanDays, Math.max(0, daysBetween(startDate, today)));
  const daysLeft = Math.max(0, daysBetween(today, examDate));
  const progressPct = Math.min(100, Math.round((daysPassed / totalPlanDays) * 100));

  const currentWeek = totalWeeks > 0 ? Math.min(totalWeeks, Math.floor(daysPassed / 7) + 1) : null;

  const summaries = buildDailySummaries(sessions);
  const goalSeconds = (dailyGoalMinutes || 0) * 60;
  const todaySeconds = summaries[today] ? summaries[today].studySeconds : 0;

  let weekSeconds = 0;
  let weekGoalSeconds = 0;
  if (currentWeek) {
    const weekStartKey = addDays(startDate, (currentWeek - 1) * 7);
    weekGoalSeconds = goalSeconds * 7;
    for (let i = 0; i < 7; i++) {
      const key = addDays(weekStartKey, i);
      if (key > today) break;
      weekSeconds += summaries[key] ? summaries[key].studySeconds : 0;
    }
  }

  return {
    totalPlanDays,
    daysPassed,
    daysLeft,
    progressPct,
    currentWeek,
    totalWeeks,
    goalSeconds,
    todaySeconds,
    weekSeconds,
    weekGoalSeconds,
  };
}

/* ------------------------------------------------------------
   Time-of-day distribution
   ------------------------------------------------------------ */

/** Local hour (0-23) a session started, using its own recorded UTC offset — not the browser's. */
function localHourOf(rec) {
  const localMs = fromIso(rec.actual.startedAt) + rec.actual.utcOffsetMinutes * 60000;
  return new Date(localMs).getUTCHours();
}

const DAYPART_ORDER = ['morning', 'afternoon', 'evening', 'night'];

function daypartOf(hour) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night'; // 21:00–04:59
}

/** Total study seconds bucketed into morning/afternoon/evening/night, in that order. */
export function buildDaypartDistribution(sessions) {
  const totals = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  for (const rec of sessions) {
    if (rec.type !== 'study' || !isCountedSession(rec)) continue;
    totals[daypartOf(localHourOf(rec))] += rec.derived.activeDurationSeconds;
  }
  return DAYPART_ORDER.map((key) => ({ key, seconds: totals[key] }));
}

/* ------------------------------------------------------------
   Weekday averages
   ------------------------------------------------------------ */

/**
 * Average study time per weekday, indexed 0 (Sunday) – 6 (Saturday) to
 * match Date.prototype.getUTCDay(). The average is over days that had
 * any counted study time (not every calendar day), so it reads as
 * "on the days I studied, how much did I typically get done on a
 * <weekday>" rather than a zero-inflated daily average.
 */
export function buildWeekdayAverages(sessions) {
  const summaries = buildDailySummaries(sessions);
  const sums = Array(7).fill(0);
  const counts = Array(7).fill(0);

  for (const [dayKey, s] of Object.entries(summaries)) {
    const [y, m, d] = dayKey.split('-').map(Number);
    const weekday = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
    sums[weekday] += s.studySeconds;
    counts[weekday] += 1;
  }

  return Array.from({ length: 7 }, (_, w) => ({
    weekday: w,
    averageSeconds: counts[w] > 0 ? Math.round(sums[w] / counts[w]) : 0,
  }));
}

/* ------------------------------------------------------------
   Session length distribution
   ------------------------------------------------------------ */

const DURATION_BUCKETS = [
  { key: '<=25', maxSeconds: 25 * 60 },
  { key: '26-50', maxSeconds: 50 * 60 },
  { key: '51-90', maxSeconds: 90 * 60 },
  { key: '90+', maxSeconds: Infinity },
];

/** Session counts (completed/abandoned, long enough to count) bucketed by actual duration. */
export function buildSessionLengthDistribution(sessions) {
  const counts = DURATION_BUCKETS.map(() => 0);
  for (const rec of sessions) {
    if (rec.type !== 'study' || !isCountedSession(rec)) continue;
    const seconds = rec.derived.activeDurationSeconds;
    const idx = DURATION_BUCKETS.findIndex((b) => seconds <= b.maxSeconds);
    counts[idx === -1 ? DURATION_BUCKETS.length - 1 : idx] += 1;
  }
  return DURATION_BUCKETS.map((b, i) => ({ key: b.key, count: counts[i] }));
}

/* ------------------------------------------------------------
   Monthly series
   ------------------------------------------------------------ */

/** Study totals grouped by calendar month ("YYYY-MM"), oldest first. Only months with recorded study appear — no zero-filling, since the span can be arbitrarily long. */
export function buildMonthlySeries(sessions) {
  const summaries = buildDailySummaries(sessions);
  const months = new Map();

  for (const [dayKey, s] of Object.entries(summaries)) {
    const monthKey = dayKey.slice(0, 7);
    const m = months.get(monthKey) || { monthKey, studySeconds: 0, sessionCount: 0 };
    m.studySeconds += s.studySeconds;
    m.sessionCount += s.sessionCount;
    months.set(monthKey, m);
  }

  return [...months.values()].sort((a, b) => (a.monthKey < b.monthKey ? -1 : 1));
}