/* Exam-plan progress (countdown, current week, today/week study vs. goal). */

import { buildDailySummaries } from '../../dataLayer.js';
import { addDays, daysBetween, saturdayWeekRange, todayKey } from './dateUtils.js';
import { getPlanDaysInRange, plannedMinutesOfDay } from './planAdherence.js';

/**
 * Dates come from Settings; when Settings has none they are detected
 * from the weekly plan files (earliest start → latest end).
 */
function resolvePlanDates(studyPlan, plans) {
  const { startDate, examDate, totalWeeks } = studyPlan || {};
  if (startDate && examDate) return { startDate, examDate, totalWeeks };

  const starts = plans.map((p) => p?.startDate).filter(Boolean).sort();
  const ends = plans.map((p) => p?.endDate).filter(Boolean).sort();
  if (!starts.length || !ends.length) return null;

  const detectedStart = starts[0];
  const detectedEnd = ends[ends.length - 1];

  return {
    startDate: detectedStart,
    examDate: detectedEnd,
    totalWeeks: Math.max(1, Math.ceil((daysBetween(detectedStart, detectedEnd) + 1) / 7)),
  };
}

/**
 * Returns null when no dates are available (neither Settings nor plan files).
 *
 * Week numbers (currentWeek/totalWeeks) are counted from startDate, but the
 * weekSeconds / weekGoalSeconds figures always cover the Saturday..Friday week
 * that contains today — the same weeks the timer page shows.
 * weekGoalSeconds = planned minutes of that week, else dailyGoal × 7.
 */
export function buildExamPlanStatus(studyPlan, sessions, plans = []) {
  const dates = resolvePlanDates(studyPlan, plans);
  if (!dates) return null;

  const { startDate, examDate, totalWeeks } = dates;
  const today = todayKey();

  const totalPlanDays = Math.max(1, daysBetween(startDate, examDate));
  const daysPassed = Math.min(totalPlanDays, Math.max(0, daysBetween(startDate, today)));
  const daysLeft = Math.max(0, daysBetween(today, examDate));
  const progressPct = Math.min(100, Math.round((daysPassed / totalPlanDays) * 100));
  const currentWeek = totalWeeks > 0 ? Math.min(totalWeeks, Math.floor(daysPassed / 7) + 1) : null;

  const summaries = buildDailySummaries(sessions);
  const studySecondsOn = (key) => (summaries[key] ? summaries[key].studySeconds : 0);

  const goalSeconds = (studyPlan?.dailyGoalMinutes || 0) * 60;

  const { start, end } = saturdayWeekRange(today);
  let weekSeconds = 0;
  for (let key = start; key <= end && key <= today; key = addDays(key, 1)) {
    weekSeconds += studySecondsOn(key);
  }

  const plannedMinutes = getPlanDaysInRange(plans, start, end).reduce(
    (sum, day) => sum + plannedMinutesOfDay(day),
    0
  );
  const weekGoalSeconds = plannedMinutes > 0 ? plannedMinutes * 60 : goalSeconds * 7;

  return {
    totalPlanDays,
    daysPassed,
    daysLeft,
    progressPct,
    currentWeek,
    totalWeeks,
    goalSeconds,
    todaySeconds: studySecondsOn(today),
    weekSeconds,
    weekGoalSeconds,
  };
}
