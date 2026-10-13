/* When and how long you study: hour, day-part, weekday, session length. */

import { buildDailySummaries, fromIso, isCountedSession } from '../../dataLayer.js';
import { weekdayOf } from './dateUtils.js';

const isCountedStudy = (rec) => rec.type === 'study' && isCountedSession(rec);

/** Local hour (0-23) a session started — uses its own recorded UTC offset, not the browser's. */
function localHourOf(rec) {
  const localMs = fromIso(rec.actual.startedAt) + rec.actual.utcOffsetMinutes * 60000;
  return new Date(localMs).getUTCHours();
}

/* ---------- hour of day ---------- */

/** Study seconds by local start hour → [{ hour, seconds }] × 24. */
export function buildHourOfDayDistribution(sessions) {
  const buckets = Array(24).fill(0);
  for (const rec of sessions) {
    if (!isCountedStudy(rec)) continue;
    buckets[localHourOf(rec)] += rec.derived.activeDurationSeconds;
  }
  return buckets.map((seconds, hour) => ({ hour, seconds }));
}

/* ---------- day part ---------- */

const DAYPART_ORDER = ['morning', 'afternoon', 'evening', 'night'];

function daypartOf(hour) {
  if (hour >= 5 && hour < 12) return 'morning';
  if (hour >= 12 && hour < 17) return 'afternoon';
  if (hour >= 17 && hour < 21) return 'evening';
  return 'night'; // 21:00–04:59
}

export function buildDaypartDistribution(sessions) {
  const totals = { morning: 0, afternoon: 0, evening: 0, night: 0 };
  for (const rec of sessions) {
    if (!isCountedStudy(rec)) continue;
    totals[daypartOf(localHourOf(rec))] += rec.derived.activeDurationSeconds;
  }
  return DAYPART_ORDER.map((key) => ({ key, seconds: totals[key] }));
}

/* ---------- weekday ---------- */

/**
 * Average study time per weekday, indexed 0 (Sunday) – 6 (Saturday).
 * Averaged over days that had study time (not every calendar day), so it
 * reads "on days I studied, how much did I get done on a <weekday>".
 */
export function buildWeekdayAverages(sessions) {
  const summaries = buildDailySummaries(sessions);
  const sums = Array(7).fill(0);
  const counts = Array(7).fill(0);

  for (const [dayKey, s] of Object.entries(summaries)) {
    const weekday = weekdayOf(dayKey);
    sums[weekday] += s.studySeconds;
    counts[weekday] += 1;
  }

  return Array.from({ length: 7 }, (_, w) => ({
    weekday: w,
    averageSeconds: counts[w] > 0 ? Math.round(sums[w] / counts[w]) : 0,
  }));
}

/* ---------- session length ---------- */

const DURATION_BUCKETS = [
  { key: '<=25', maxSeconds: 25 * 60 },
  { key: '26-50', maxSeconds: 50 * 60 },
  { key: '51-90', maxSeconds: 90 * 60 },
  { key: '90+', maxSeconds: Infinity },
];

/** Counted study sessions bucketed by actual duration. */
export function buildSessionLengthDistribution(sessions) {
  const counts = DURATION_BUCKETS.map(() => 0);

  for (const rec of sessions) {
    if (!isCountedStudy(rec)) continue;
    const seconds = rec.derived.activeDurationSeconds;
    const idx = DURATION_BUCKETS.findIndex((b) => seconds <= b.maxSeconds);
    counts[idx === -1 ? DURATION_BUCKETS.length - 1 : idx] += 1;
  }

  return DURATION_BUCKETS.map((b, i) => ({ key: b.key, count: counts[i] }));
}
