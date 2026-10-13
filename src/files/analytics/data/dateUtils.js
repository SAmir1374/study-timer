/* =============================================================
   analytics/data/dateUtils.js — day-key ("YYYY-MM-DD") arithmetic.

   A local copy rather than importing state.js: analytics only ever
   works on a loaded document snapshot, never the live app state.
   ============================================================= */

import { currentUtcOffsetMinutes, dateKeyOf } from '../../dataLayer.js';

const DAY_MS = 86400000;

function dayNumber(key) {
  const [y, m, d] = key.split('-').map(Number);
  return Date.UTC(y, m - 1, d) / DAY_MS;
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

/** 0 (Sunday) – 6 (Saturday), same as Date.prototype.getUTCDay(). */
export function weekdayOf(key) {
  return new Date(dayNumber(key) * DAY_MS).getUTCDay();
}

/** Saturday..Friday range containing dateKey. */
export function saturdayWeekRange(dateKey) {
  const date = new Date(dayNumber(dateKey) * DAY_MS);
  const daysSinceSaturday = (date.getUTCDay() + 1) % 7;

  const start = new Date(date);
  start.setUTCDate(date.getUTCDate() - daysSinceSaturday);

  const end = new Date(start);
  end.setUTCDate(start.getUTCDate() + 6);

  const toKey = (value) => value.toISOString().slice(0, 10);
  return { start: toKey(start), end: toKey(end) };
}
