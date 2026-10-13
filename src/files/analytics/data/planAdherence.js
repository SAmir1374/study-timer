/* =============================================================
   Weekly-plan adherence: planned (weekly-plans.json) vs. actual
   (study-data.json sessions).

   Matching = subject + practice flag + calendar day.
   ============================================================= */

import { sessionDayKey } from '../../dataLayer.js';
import { getSortedPlanDays } from '../../weeklyPlanData.js';
import { saturdayWeekRange, todayKey } from './dateUtils.js';

/** Minutes actually studied for one planned (subject, isPractice) slot on one day. */
export function getActualMinutesForSubjectOnDate(sessions, dateKey, subject, isPractice) {
  return sessions.reduce((total, session) => {
    if (!session?.actual?.startedAt) return total;
    if (session.subject !== subject) return total;
    if (Boolean(session.isPractice) !== Boolean(isPractice)) return total;
    if (sessionDayKey(session) !== dateKey) return total;

    return total + (Number(session?.derived?.activeDurationSeconds) || 0) / 60;
  }, 0);
}

export function plannedMinutesOfDay(day) {
  const planned = Array.isArray(day?.sessions) ? day.sessions : [];
  return planned.reduce((sum, s) => sum + (Number(s.minutes) || 0), 0);
}

/** Plan days (from every plan file that overlaps the range) with start <= date <= end. */
export function getPlanDaysInRange(plans, start, end) {
  const days = [];
  for (const plan of plans) {
    if (plan.endDate < start || plan.startDate > end) continue;
    for (const day of getSortedPlanDays(plan)) {
      if (day.date >= start && day.date <= end) days.push(day);
    }
  }
  return days;
}

/**
 * One row per plan-file week that has at least one day up to today, oldest first:
 * { weekStart, weekEnd, title, plannedMinutes, actualMinutes, adherencePct }.
 * adherencePct is uncapped (studying more than planned can exceed 100).
 */
export function buildWeeklyPlanAdherence(plans, sessions, today = todayKey()) {
  const result = [];

  for (const plan of plans) {
    const days = getSortedPlanDays(plan).filter((d) => d.date <= today);
    if (!days.length) continue;

    let planned = 0;
    let actual = 0;

    for (const day of days) {
      for (const slot of Array.isArray(day.sessions) ? day.sessions : []) {
        planned += Number(slot.minutes) || 0;
        actual += getActualMinutesForSubjectOnDate(sessions, day.date, slot.subject, slot.isPractice);
      }
    }

    if (planned <= 0) continue;

    result.push({
      weekStart: plan.startDate,
      weekEnd: plan.endDate,
      title: plan.title,
      plannedMinutes: Math.round(planned),
      actualMinutes: Math.round(actual),
      adherencePct: Math.round((actual / planned) * 100),
    });
  }

  return result.sort((a, b) => (a.weekStart < b.weekStart ? -1 : 1));
}

/**
 * Per-subject planned-vs-actual for the current Saturday..Friday week,
 * aggregated across every overlapping plan file. Sorted by planned minutes.
 */
export function buildCurrentWeekPlanComparison(plans, sessions, today = todayKey()) {
  const { start, end } = saturdayWeekRange(today);
  const bySubject = new Map();

  for (const day of getPlanDaysInRange(plans, start, end)) {
    for (const slot of Array.isArray(day.sessions) ? day.sessions : []) {
      if (!bySubject.has(slot.subject)) {
        bySubject.set(slot.subject, { subject: slot.subject, plannedMinutes: 0, actualMinutes: 0 });
      }
      const item = bySubject.get(slot.subject);
      item.plannedMinutes += Number(slot.minutes) || 0;
      item.actualMinutes += getActualMinutesForSubjectOnDate(
        sessions,
        day.date,
        slot.subject,
        slot.isPractice
      );
    }
  }

  return [...bySubject.values()]
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
