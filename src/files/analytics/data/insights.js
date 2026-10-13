/* =============================================================
   Rule-based insights (not AI-generated).

   Returns a short list of { type, ...vars }. The view maps `type`
   to a translated template, so phrasing/i18n stays in the view.
   ============================================================= */

import { completionRatePercent } from './overview.js';

const last = (arr) => arr[arr.length - 1];

export function buildInsights({
  stats,
  streaks,
  adherenceWeeks = [],
  currentWeekComparison = [],
}) {
  const insights = [];

  // Streak
  if (streaks) {
    if (streaks.current >= 3) {
      insights.push({ type: 'streakGood', days: streaks.current });
    } else if (streaks.current === 0 && streaks.longest > 0) {
      insights.push({ type: 'streakBroken', longest: streaks.longest });
    }
  }

  // Plan adherence: trend, then absolute level of the latest week
  if (adherenceWeeks.length >= 2) {
    const latest = last(adherenceWeeks);
    const prev = adherenceWeeks[adherenceWeeks.length - 2];
    if (latest.adherencePct >= prev.adherencePct + 10) {
      insights.push({ type: 'adherenceUp', pct: latest.adherencePct });
    } else if (latest.adherencePct <= prev.adherencePct - 10) {
      insights.push({ type: 'adherenceDown', pct: latest.adherencePct });
    }
  }

  if (adherenceWeeks.length >= 1) {
    const latest = last(adherenceWeeks);
    if (latest.adherencePct < 60) {
      insights.push({ type: 'adherenceLow', pct: latest.adherencePct });
    } else if (latest.adherencePct >= 100) {
      insights.push({ type: 'adherencePerfect', pct: latest.adherencePct });
    }
  }

  // This week, per subject
  const behind = currentWeekComparison
    .filter((s) => s.plannedMinutes > 0 && s.pct < 50)
    .sort((a, b) => a.pct - b.pct)[0];
  if (behind) insights.push({ type: 'subjectBehind', subject: behind.subject, pct: behind.pct });

  const ahead = currentWeekComparison.find((s) => s.plannedMinutes > 0 && s.pct >= 100);
  if (ahead) insights.push({ type: 'subjectDone', subject: ahead.subject });

  // Completion rate
  if (stats) {
    const rate = completionRatePercent(stats);
    if (rate !== null && rate < 60) insights.push({ type: 'lowCompletion', pct: rate });
    else if (rate !== null && rate >= 90) insights.push({ type: 'highCompletion', pct: rate });
  }

  return insights;
}
