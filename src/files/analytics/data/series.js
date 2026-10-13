/* Time series: daily, weekly (rolling), monthly, and the activity heatmap. */

import { buildDailySummaries } from '../../dataLayer.js';
import { addDays, todayKey, weekdayOf } from './dateUtils.js';

/** Daily study series for `days` days ending today (inclusive), oldest first. */
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

/** Rolling 7-day buckets, `weeks` of them ending today, oldest first. */
export function buildWeeklySeries(sessions, weeks) {
  const daily = buildDailySeries(sessions, weeks * 7);
  const sum = (slice, field) => slice.reduce((total, d) => total + d[field], 0);

  return Array.from({ length: weeks }, (_, w) => {
    const slice = daily.slice(w * 7, w * 7 + 7);
    return {
      startKey: slice[0].dayKey,
      endKey: slice[slice.length - 1].dayKey,
      studySeconds: sum(slice, 'studySeconds'),
      sessionCount: sum(slice, 'sessionCount'),
    };
  });
}

/** Highest study-time day in a daily series (null if empty). */
export function bestDayOf(dailySeries) {
  return dailySeries.reduce(
    (best, d) => (d.studySeconds > (best ? best.studySeconds : -1) ? d : best),
    null
  );
}

/** Days in the series that met or exceeded the per-day goal. */
export function goalDaysCount(dailySeries, goalSeconds) {
  if (!goalSeconds) return 0;
  return dailySeries.filter((d) => d.studySeconds >= goalSeconds).length;
}

/**
 * Study totals per calendar month ("YYYY-MM"), oldest first.
 * Only months with recorded study appear (no zero-filling).
 */
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

/**
 * Last N days grouped into Saturday-first weeks (GitHub-style).
 * Returns { weeks: [[{ dayKey, seconds, level }]], maxSeconds }
 * level 0..5 = how the day compares to the maximum.
 */
export function buildActivityHeatmap(sessions, days = 91) {
  const summaries = buildDailySummaries(sessions);
  const today = todayKey();

  const dayList = [];
  for (let i = days - 1; i >= 0; i--) {
    const key = addDays(today, -i);
    dayList.push({ dayKey: key, seconds: summaries[key] ? summaries[key].studySeconds : 0 });
  }

  // Pad the start so the first column begins on Saturday (Sat=0 … Fri=6).
  const padStart = (weekdayOf(dayList[0].dayKey) + 1) % 7;
  for (let i = 0; i < padStart; i++) dayList.unshift({ dayKey: null, seconds: 0 });

  const maxSeconds = Math.max(...dayList.map((d) => d.seconds), 1);

  const weeks = [];
  for (let i = 0; i < dayList.length; i += 7) {
    weeks.push(
      dayList.slice(i, i + 7).map((d) => {
        if (!d.dayKey) return { dayKey: null, seconds: 0, level: 0 };
        const level = d.seconds === 0 ? 0 : Math.min(5, Math.ceil((d.seconds / maxSeconds) * 5));
        return { ...d, level };
      })
    );
  }

  return { weeks, maxSeconds };
}
