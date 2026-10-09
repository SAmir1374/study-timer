/* =============================================================
   analyticsData.js

   Pure aggregation over a parsed study-data.json document (and,
   for weekly-plan functions, a parsed weekly-plans.json document).
   No DOM, no storage — takes plain data and returns plain data for
   analyticsCharts.js / analyticsApp.js to render. Never mutates
   its inputs.
   ============================================================= */

import {
  buildDailySummaries,
  isCountedSession,
  currentUtcOffsetMinutes,
  dateKeyOf,
  fromIso,
  sessionDayKey,
} from "./dataLayer.js";
import { getSortedPlanDays } from "./weeklyPlanData.js";

/* ------------------------------------------------------------
   Hour-of-day distribution (0–23)
   ------------------------------------------------------------ */

/** Study seconds bucketed by local start hour (0–23). */
export function buildHourOfDayDistribution(sessions) {
  const buckets = Array(24).fill(0);
  for (const rec of sessions) {
    if (rec.type !== "study" || !isCountedSession(rec)) continue;
    const hour = localHourOf(rec);
    buckets[hour] += rec.derived.activeDurationSeconds;
  }
  return buckets.map((seconds, hour) => ({ hour, seconds }));
}

/* ------------------------------------------------------------
   Heatmap grid (GitHub-style: weeks × days)
   ------------------------------------------------------------ */

/**
 * Builds the last N days grouped into weeks (Saturday-first).
 * Returns: { weeks: [[{dayKey, seconds, level}]], maxSeconds }
 * level: 0..5 based on how the day compares to the maximum.
 */
export function buildActivityHeatmap(sessions, days = 91) {
  const summaries = buildDailySummaries(sessions);
  const today = todayKey();

  // Build sequence of days ending today, oldest first
  const dayList = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = addDays(today, -i);
    const secs = summaries[key] ? summaries[key].studySeconds : 0;
    dayList.push({ dayKey: key, seconds: secs });
  }

  // Pad start so first week starts on Saturday
  const firstKey = dayList[0].dayKey;
  const [fy, fm, fd] = firstKey.split("-").map(Number);
  const firstWd = new Date(Date.UTC(fy, fm - 1, fd)).getUTCDay();
  // Saturday=6 in JS, we want it as column 0 → offset
  const padStart = (firstWd + 1) % 7; // Sat=0, Sun=1, ..., Fri=6
  for (let i = 0; i < padStart; i++) dayList.unshift({ dayKey: null, seconds: 0 });

  const maxSeconds = Math.max(...dayList.map((d) => d.seconds), 1);

  const weeks = [];
  for (let i = 0; i < dayList.length; i += 7) {
    const chunk = dayList.slice(i, i + 7);
    weeks.push(
      chunk.map((d) => {
        if (!d.dayKey) return { dayKey: null, seconds: 0, level: 0 };
        const ratio = d.seconds / maxSeconds;
        const level = d.seconds === 0 ? 0 : Math.min(5, Math.ceil(ratio * 5));
        return { ...d, level };
      }),
    );
  }
  return { weeks, maxSeconds };
}

/* ------------------------------------------------------------
   Day-key arithmetic

   A local copy rather than importing state.js: analytics only ever
   works on a loaded document snapshot, never the live app state.
   ------------------------------------------------------------ */

function dayNumber(key) {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

export function addDays(key, n) {
  const [y, m, d] = key.split("-").map(Number);
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
    totalStudySeconds: 0, // regular study + practice tests
    totalPracticeSeconds: 0, // the practice-test part of totalStudySeconds
    totalBreakSeconds: 0,
    totalPausedSeconds: 0,
    totalPauseCount: 0,
    totalSessions: 0, // counted study sessions (completed or abandoned, long enough to count)
    practiceSessions: 0, // counted practice-test sessions (subset of totalSessions)
    completedSessions: 0,
    abandonedSessions: 0,
    cancelledSessions: 0,
  };

  for (const rec of sessions) {
    if (rec.derived) {
      stats.totalPausedSeconds += rec.derived.totalPausedSeconds || 0;
      stats.totalPauseCount += rec.derived.pauseCount || 0;
    }

    if (rec.type === "study") {
      if (isCountedSession(rec)) {
        stats.totalStudySeconds += rec.derived.activeDurationSeconds;
        stats.totalSessions += 1;
        if (rec.isPractice) {
          stats.totalPracticeSeconds += rec.derived.activeDurationSeconds;
          stats.practiceSessions += 1;
        }
      }
      if (rec.status === "completed") stats.completedSessions += 1;
      else if (rec.status === "abandoned") stats.abandonedSessions += 1;
      else if (rec.status === "cancelled") stats.cancelledSessions += 1;
    } else if (rec.type === "break" && isCountedSession(rec)) {
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
 *
 * "Practice test" is a property of each SESSION (rec.isPractice), so one
 * subject row carries both numbers:
 *   studySeconds / sessionCount  → everything (regular study + practice)
 *   practiceSeconds / practiceSessionCount → only the practice-test part
 * Regular study time is therefore studySeconds - practiceSeconds.
 *
 * Accepts either the current `{name}[]` shape or a plain string array
 * (older/hand-written files), so an unmigrated subjects list here
 * doesn't crash the page.
 */
export function buildSubjectStats(sessions, subjects = []) {
  const map = new Map();

  const blank = (name) => ({
    subject: name,
    studySeconds: 0,
    sessionCount: 0,
    completedSessions: 0,
    abandonedSessions: 0,
    practiceSeconds: 0,
    practiceSessionCount: 0,
  });

  for (const subject of subjects) {
    const name = typeof subject === "string" ? subject : subject.name;
    map.set(name, blank(name));
  }

  for (const rec of sessions) {
    if (rec.type !== "study" || !rec.subject || !isCountedSession(rec)) {
      continue;
    }

    if (!map.has(rec.subject)) map.set(rec.subject, blank(rec.subject));

    const item = map.get(rec.subject);

    item.studySeconds += rec.derived.activeDurationSeconds;
    item.sessionCount += 1;

    if (rec.status === "completed") {
      item.completedSessions += 1;
    }

    if (rec.status === "abandoned") {
      item.abandonedSessions += 1;
    }

    if (rec.isPractice) {
      item.practiceSeconds += rec.derived.activeDurationSeconds;
      item.practiceSessionCount += 1;
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
  return dailySeries.reduce((best, d) => (d.studySeconds > (best ? best.studySeconds : -1) ? d : best), null);
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

const DAYPART_ORDER = ["morning", "afternoon", "evening", "night"];

function daypartOf(hour) {
  if (hour >= 5 && hour < 12) return "morning";
  if (hour >= 12 && hour < 17) return "afternoon";
  if (hour >= 17 && hour < 21) return "evening";
  return "night"; // 21:00–04:59
}

/** Total study seconds bucketed into morning/afternoon/evening/night, in that order. */
export function buildDaypartDistribution(sessions) {
  const totals = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  for (const rec of sessions) {
    if (rec.type !== "study" || !isCountedSession(rec)) continue;
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
    const [y, m, d] = dayKey.split("-").map(Number);
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
  { key: "<=25", maxSeconds: 25 * 60 },
  { key: "26-50", maxSeconds: 50 * 60 },
  { key: "51-90", maxSeconds: 90 * 60 },
  { key: "90+", maxSeconds: Infinity },
];

/** Session counts (completed/abandoned, long enough to count) bucketed by actual duration. */
export function buildSessionLengthDistribution(sessions) {
  const counts = DURATION_BUCKETS.map(() => 0);
  for (const rec of sessions) {
    if (rec.type !== "study" || !isCountedSession(rec)) continue;
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

/* ------------------------------------------------------------
   Weekly plan adherence

   Everything below is derived from a WeeklyPlanStore document (an
   array of `plan` objects, each with day entries, each with planned
   `sessions`) cross-referenced against the *study-data* sessions.
   Matching mirrors ui.js's getActualMinutesForSubjectOnDate exactly
   (subject + practice flag + calendar day), so the numbers shown
   here always agree with the timer page.
   ------------------------------------------------------------ */

/** Minutes actually studied for one planned (subject, isPractice) slot on one day. */
export function getActualMinutesForSubjectOnDate(sessions, dateKey, subject, isPractice) {
  return sessions.reduce((total, session) => {
    if (!session?.actual?.startedAt) return total;
    if (session.subject !== subject) return total;
    if (Boolean(session.isPractice) !== Boolean(isPractice)) return total;
    if (sessionDayKey(session) !== dateKey) return total;

    const seconds = Number(session?.derived?.activeDurationSeconds) || 0;
    return total + seconds / 60;
  }, 0);
}

/** Saturday..Friday range containing dateKey (both "YYYY-MM-DD"). Same convention as ui.js. */
export function saturdayWeekRange(dateKey) {
  const [year, month, day] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  const weekday = date.getUTCDay();
  const daysSinceSaturday = (weekday + 1) % 7;
  const start = new Date(date);
  start.setUTCDate(date.getUTCDate() - daysSinceSaturday);
  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);
  const toKey = (value) => value.toISOString().slice(0, 10);
  return { start: toKey(start), end: toKey(end) };
}

/**
 * One row per plan-file "week" that has at least one day up to today
 * (future weeks are skipped — there's nothing to compare yet), sorted
 * oldest first: { weekStart, weekEnd, title, plannedMinutes,
 * actualMinutes, adherencePct }. adherencePct is uncapped (a week
 * studied *more* than planned can exceed 100).
 */
export function buildWeeklyPlanAdherence(plans, sessions, today = todayKey()) {
  const result = [];

  for (const plan of plans) {
    const days = getSortedPlanDays(plan).filter((d) => d.date <= today);
    if (!days.length) continue;

    let planned = 0;
    let actual = 0;

    for (const day of days) {
      const daySessions = Array.isArray(day.sessions) ? day.sessions : [];
      for (const session of daySessions) {
        planned += Number(session.minutes) || 0;
        actual += getActualMinutesForSubjectOnDate(
          sessions,
          day.date,
          session.subject,
          session.isPractice, // ✅ v5
        );
      }
    }

    if (planned <= 0) continue;

    result.push({
      weekStart: plan.startDate, // ✅ v5
      weekEnd: plan.endDate, // ✅ v5
      title: plan.title,
      plannedMinutes: Math.round(planned),
      actualMinutes: Math.round(actual),
      adherencePct: Math.round((actual / planned) * 100),
    });
  }

  return result.sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
}

/**
 * Per-subject planned-vs-actual minutes for the current Saturday..Friday
 * week, aggregated across every plan file that overlaps it (same
 * multi-plan-file handling as ui.js's weeklyPlan() render). Sorted by
 * planned minutes descending.
 */
export function buildCurrentWeekPlanComparison(plans, sessions, today = todayKey()) {
  const { start, end } = saturdayWeekRange(today);

  let weekSeconds = 0;
  for (let key = start; key <= end && key <= today; key = addDays(key, 1)) {
    weekSeconds += summaries[key] ? summaries[key].studySeconds : 0;
  }

  let plannedMinutes = 0;
  for (const plan of plans) {
    for (const day of getSortedPlanDays(plan)) {
      if (day.date < start || day.date > end) continue;
      for (const s of day.sessions || []) plannedMinutes += Number(s.minutes) || 0;
    }
  }
  const weekGoalSeconds = plannedMinutes > 0 ? plannedMinutes * 60 : goalSeconds * 7;

  const dayEntries = [];
  for (const plan of plans) {
    // ✅ v5: از startDate/endDate استفاده می‌کنیم
    if (plan.endDate < start || plan.startDate > end) continue;
    for (const day of getSortedPlanDays(plan)) {
      if (day.date >= start && day.date <= end) dayEntries.push(day);
    }
  }

  const map = new Map();
  for (const day of dayEntries) {
    const daySessions = Array.isArray(day.sessions) ? day.sessions : [];
    for (const session of daySessions) {
      if (!map.has(session.subject)) {
        map.set(session.subject, {
          subject: session.subject,
          plannedMinutes: 0,
          actualMinutes: 0,
        });
      }
      const item = map.get(session.subject);
      item.plannedMinutes += Number(session.minutes) || 0;
      item.actualMinutes += getActualMinutesForSubjectOnDate(
        sessions,
        day.date,
        session.subject,
        session.isPractice, // ✅ v5
      );
    }
  }

  return [...map.values()]
    .map((item) => {
      const plannedMinutes = Math.round(item.plannedMinutes);
      const actualMinutes = Math.round(item.actualMinutes);
      return {
        subject: item.subject,
        plannedMinutes,
        actualMinutes,
        pct: plannedMinutes > 0 ? Math.round((actualMinutes / plannedMinutes) * 100) : 0,
      };
    })
    .sort((a, b) => b.plannedMinutes - a.plannedMinutes);
}

/* ------------------------------------------------------------
   Insights

   Rule-based (not AI-generated): a short list of { type, ...vars }
   objects. analyticsApp.js maps `type` to a translated sentence
   template and fills in `vars`. Kept as structured data here so the
   phrasing/i18n stays entirely in the presentation layer.
   ------------------------------------------------------------ */

export function buildInsights({
  stats,
  streaks,
  subjectStats = [],
  adherenceWeeks = [],
  currentWeekComparison = [],
}) {
  const insights = [];

  if (streaks) {
    if (streaks.current >= 3) {
      insights.push({ type: "streakGood", days: streaks.current });
    } else if (streaks.current === 0 && streaks.longest > 0) {
      insights.push({ type: "streakBroken", longest: streaks.longest });
    }
  }

  if (adherenceWeeks.length >= 2) {
    const last = adherenceWeeks[adherenceWeeks.length - 1];
    const prev = adherenceWeeks[adherenceWeeks.length - 2];
    if (last.adherencePct >= prev.adherencePct + 10) {
      insights.push({ type: "adherenceUp", pct: last.adherencePct });
    } else if (last.adherencePct <= prev.adherencePct - 10) {
      insights.push({ type: "adherenceDown", pct: last.adherencePct });
    }
  }

  if (adherenceWeeks.length >= 1) {
    const last = adherenceWeeks[adherenceWeeks.length - 1];
    if (last.adherencePct < 60) {
      insights.push({ type: "adherenceLow", pct: last.adherencePct });
    } else if (last.adherencePct >= 100) {
      insights.push({ type: "adherencePerfect", pct: last.adherencePct });
    }
  }

  const behind = currentWeekComparison
    .filter((s) => s.plannedMinutes > 0 && s.pct < 50)
    .sort((a, b) => a.pct - b.pct)[0];
  if (behind) {
    insights.push({ type: "subjectBehind", subject: behind.subject, pct: behind.pct });
  }

  const ahead = currentWeekComparison.find((s) => s.plannedMinutes > 0 && s.pct >= 100);
  if (ahead) {
    insights.push({ type: "subjectDone", subject: ahead.subject });
  }

  if (stats) {
    const rate = completionRatePercent(stats);
    if (rate !== null && rate < 60) {
      insights.push({ type: "lowCompletion", pct: rate });
    } else if (rate !== null && rate >= 90) {
      insights.push({ type: "highCompletion", pct: rate });
    }
  }

  return insights;
}
