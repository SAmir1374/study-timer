/* Helpers shared by the three day-modal tabs. */

import { getDaySessions } from '../../state.js';
import { fromIso } from '../../dataLayer.js';
import { calendarLocale } from '../utils.js';

export const DAY_HOUR_PX = 44;

export const isWorkRecord = (rec) => rec?.type === 'study' || rec?.type === 'review';

export const activeSeconds = (rec) => Number(rec?.derived?.activeDurationSeconds) || 0;

export function dayStat(label, value) {
  return `<div class="day-modal__stat"><span>${label}</span><strong>${value}</strong></div>`;
}

export function formatDateKeyForModal(dateKey, language, options = {}) {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (![year, month, day].every(Number.isFinite)) return dateKey;

  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return date.toLocaleDateString(calendarLocale(language), { timeZone: 'UTC', ...options });
}

export function formatPlanMinutes(value, language) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  return minutes.toLocaleString(language === 'fa' ? 'fa-IR' : 'en-US');
}

export function getDayModalStatusLabel(status, fa) {
  const labels = {
    future: fa ? 'پیش‌رو' : 'Upcoming',
    today: fa ? 'امروز' : 'Today',
    partial: fa ? 'ثبت شده' : 'Recorded',
    missed: fa ? 'بدون ثبت' : 'No record',
  };
  return labels[status] || status;
}

/**
 * Recorded sessions clipped to the (local) day, as
 * { rec, startMin, endMin } — minutes since local midnight.
 */
export function getDayBlocks(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const dayStart = new Date(y, m - 1, d).getTime();
  const dayEnd = new Date(y, m - 1, d + 1).getTime();

  return getDaySessions(dateKey)
    .map((rec) => {
      if (!rec?.actual?.startedAt || !rec?.actual?.endedAt) return null;

      const started = new Date(fromIso(rec.actual.startedAt)).getTime();
      const ended = new Date(fromIso(rec.actual.endedAt)).getTime();
      const start = Math.max(started, dayStart);
      const end = Math.min(ended, dayEnd);
      if (!(end > start)) return null;

      return { rec, startMin: (start - dayStart) / 60000, endMin: (end - dayStart) / 60000 };
    })
    .filter(Boolean);
}
