/* analytics/view/elements.js — DOM references used by analytics.html's script. */

const $ = (id) => document.getElementById(id);

export const el = {
  // Header
  langFaBtn: $('aLangFaBtn'),
  langEnBtn: $('aLangEnBtn'),
  themeToggle: $('aThemeToggle'),

  // Connect / file bar
  connectSection: $('connectSection'),
  openFileBtn: $('openFileBtn'),
  importFileInput: $('importFileInput'),
  contentSection: $('contentSection'),
  fileNameLabel: $('fileNameLabel'),
  refreshBtn: $('refreshBtn'),
  changeFileBtn: $('changeFileBtn'),
  emptyState: $('emptyState'),

  // Hero / KPIs / exam
  analyticsHero: $('analyticsHero'),
  kpiGrid: $('kpiGrid'),
  analyticsExam: $('analyticsExam'),

  // Heatmap
  activityHeatmap: $('activityHeatmap'),
  heatmapLegend: $('heatmapLegend'),

  // Trends
  dailyChart: $('dailyChart'),
  weeklyChart: $('weeklyChart'),
  weeklyChartHint: $('weeklyChartHint'),
  monthlySection: $('monthlySection'),
  monthlyChart: $('monthlyChart'),

  // Subjects
  subjectStats: $('subjectStats'),
  subjectDonutChart: $('subjectDonutChart'),
  subjectDonutLegend: $('subjectDonutLegend'),

  // Patterns
  hourChart: $('hourChart'),
  daypartChart: $('daypartChart'),
  weekdayChart: $('weekdayChart'),
  sessionLengthChart: $('sessionLengthChart'),
  donutChart: $('donutChart'),
  donutLegend: $('donutLegend'),
  pauseDonutChart: $('pauseDonutChart'),
  pauseDonutLegend: $('pauseDonutLegend'),

  // Weekly plan
  statPlanAdherence: $('statPlanAdherence'),
  statPlanAdherenceMeta: $('statPlanAdherenceMeta'),
  weeklyPlanStatusLabel: $('weeklyPlanStatusLabel'),
  weeklyPlanConnectBtn: $('weeklyPlanConnectBtn'),
  weeklyPlanEmptyState: $('weeklyPlanEmptyState'),
  weeklyPlanContent: $('weeklyPlanContent'),
  weeklyPlanAdherenceChart: $('weeklyPlanAdherenceChart'),
  weeklyPlanCurrentWeekList: $('weeklyPlanCurrentWeekList'),

  // Insights
  insightsList: $('insightsList'),
  insightsEmpty: $('insightsEmpty'),

  // Toast
  toast: $('toast'),
  toastText: $('toastText'),
};
