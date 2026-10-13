/* =============================================================
   analytics/view/render.js — renders the whole page from a parsed
   study-data document.
   ============================================================= */

import { WeeklyPlanStore } from '../../weeklyPlanStore.js';
import {
  averageSessionSeconds,
  bestDayOf,
  buildDailySeries,
  buildExamPlanStatus,
  buildMonthlySeries,
  buildOverallStats,
  buildStreaks,
  buildSubjectStats,
  buildWeeklySeries,
  completionRatePercent,
  goalDaysCount,
} from '../data/index.js';
import { el } from './elements.js';
import { DAILY_WINDOW_DAYS, WEEKLY_WINDOW_WEEKS } from './constants.js';
import { store } from './store.js';
import { renderHero } from './sections/hero.js';
import { renderKpis } from './sections/kpis.js';
import { renderHeatmap } from './sections/heatmap.js';
import { renderExamStatusAnalytics } from './sections/exam.js';
import { renderSubjectDonut, renderSubjectStats } from './sections/subjects.js';
import { renderDailyChart, renderMonthlyChart, renderWeeklyChart } from './sections/trends.js';
import {
  renderDaypartChart,
  renderHourChart,
  renderOutcomeDonut,
  renderPauseDonut,
  renderSessionLengthChart,
  renderWeekdayChart,
} from './sections/patterns.js';
import { renderWeeklyPlanSection } from './sections/weeklyPlan.js';

/** Containers that must be blanked when there is no finished session yet. */
const CLEARED_WHEN_EMPTY = [
  'kpiGrid',
  'activityHeatmap',
  'dailyChart',
  'weeklyChart',
  'subjectStats',
  'subjectDonutChart',
  'subjectDonutLegend',
  'donutChart',
  'donutLegend',
  'pauseDonutChart',
  'pauseDonutLegend',
  'daypartChart',
  'weekdayChart',
  'hourChart',
  'sessionLengthChart',
];

function renderEmptyState() {
  el.emptyState.hidden = false;

  CLEARED_WHEN_EMPTY.forEach((key) => {
    if (el[key]) el[key].innerHTML = '';
  });

  if (el.monthlySection) el.monthlySection.hidden = true;
  if (el.insightsList) el.insightsList.innerHTML = '';
  if (el.insightsEmpty) el.insightsEmpty.hidden = false;

  renderWeeklyPlanSection();
}

export function renderAnalytics(doc) {
  const sessions = doc.sessions || [];
  const subjects = doc.subjects || [];
  const plans = WeeklyPlanStore.getWeeks();

  const stats = buildOverallStats(sessions);
  const streaks = buildStreaks(sessions);
  const examStatus = buildExamPlanStatus(doc.studyPlan, sessions, plans);

  // Always shown
  renderHero(stats, streaks, examStatus);
  renderExamStatusAnalytics(examStatus);

  // No finished sessions yet → empty state
  const finished = stats.completedSessions + stats.abandonedSessions + stats.cancelledSessions;
  if (finished === 0) return renderEmptyState();
  el.emptyState.hidden = true;

  // KPIs + heatmap
  const daily = buildDailySeries(sessions, DAILY_WINDOW_DAYS);
  const weekly = buildWeeklySeries(sessions, WEEKLY_WINDOW_WEEKS);
  const goalSeconds = (doc.studyPlan?.dailyGoalMinutes || 0) * 60;

  renderKpis({
    stats,
    streaks,
    goalSeconds,
    avgSeconds: averageSessionSeconds(stats),
    rate: completionRatePercent(stats),
    goalDays: goalDaysCount(daily, goalSeconds),
    best: bestDayOf(daily),
  });
  renderHeatmap(sessions);

  // Trends
  renderDailyChart(daily, goalSeconds);
  renderWeeklyChart(weekly);
  renderMonthlyChart(buildMonthlySeries(sessions));

  // Subjects
  const subjectStats = buildSubjectStats(sessions, subjects);
  renderSubjectStats(subjectStats, stats.totalStudySeconds);
  renderSubjectDonut(subjectStats);

  // Time patterns + session quality
  renderDaypartChart(sessions);
  renderWeekdayChart(sessions);
  renderHourChart(sessions);
  renderSessionLengthChart(sessions);
  renderOutcomeDonut(stats);
  renderPauseDonut(stats);

  // Insights + weekly plan (they read store.*)
  store.stats = stats;
  store.streaks = streaks;
  store.subjectStats = subjectStats;
  renderWeeklyPlanSection();
}

export { renderWeeklyPlanSection };
