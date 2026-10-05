/* =============================================================
   analyticsApp.js  (entry point for analytics.html)

   Read-only view over the same study-data.json used by the timer,
   plus (separately) a read-only view over weekly-plans.json via
   WeeklyPlanStore — the two files are loaded/connected independently,
   exactly as in the timer app, so this page can show either, both,
   or neither.

   Never calls FileStorage.writeText directly — study data is only
   ever read here. WeeklyPlanStore itself can write (it's the same
   store the timer page uses), but this page never edits plan
   content, only opens/reconnects the file.

   Local display prefs (language/theme) are stored separately in
   localStorage under LOCAL_PREFS_KEY and never written back into
   the study data file, so opening this page can't race with the
   timer's own save pipeline (persistence.js).
   ============================================================= */

import { parseDocument, DataError } from "./dataLayer.js";
import { FileStorage } from "./fileStorage.js";
import { fmtHoursMinutes } from "./timer.js";
import { WeeklyPlanStore } from "./weeklyPlanStore.js";
import {
  buildOverallStats,
  buildSubjectStats,
  averageSessionSeconds,
  completionRatePercent,
  buildDailySeries,
  buildWeeklySeries,
  bestDayOf,
  goalDaysCount,
  buildStreaks,
  buildExamPlanStatus,
  buildDaypartDistribution,
  buildWeekdayAverages,
  buildSessionLengthDistribution,
  buildMonthlySeries,
  buildWeeklyPlanAdherence,
  buildCurrentWeekPlanComparison,
  buildInsights,
  // ✅ جدید:
  buildHourOfDayDistribution,
  buildActivityHeatmap,
} from "./analyticsData.js";
import {
  renderBarChart,
  renderLineChart,
  renderDonutChart,
  renderCategoryBarChart,
  categoricalPalette,
  esc,
} from "./analyticsCharts.js";

const $ = (id) => document.getElementById(id);
const LOCAL_PREFS_KEY = "study-timer:analytics-prefs";
const DAILY_WINDOW_DAYS = 30;
const WEEKLY_WINDOW_WEEKS = 12;

/* Structural (non-translated-dictionary) label sets: order/rotation
   differs by language (week starts Saturday in fa), so these live
   outside I18N rather than as flat string keys. */
const WEEKDAY_LABELS = {
  en: ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  fa: ["یک", "دو", "سه", "چهار", "پنج", "جمعه", "شنبه"],
};
const WEEKDAY_DISPLAY_ORDER = {
  en: [0, 1, 2, 3, 4, 5, 6],
  fa: [6, 0, 1, 2, 3, 4, 5],
};
const SESSION_LENGTH_LABELS = {
  en: ["≤25 min", "26-50 min", "51-90 min", "90+ min"],
  fa: ["≤25 دقیقه", "26-50 دقیقه", "51-90 دقیقه", "90+ دقیقه"],
};

/** Maps buildInsights()'s `type` field to an I18N template key. */
const INSIGHT_KEY = {
  streakGood: "insightStreakGood",
  streakBroken: "insightStreakBroken",
  adherenceUp: "insightAdherenceUp",
  adherenceDown: "insightAdherenceDown",
  adherenceLow: "insightAdherenceLow",
  adherencePerfect: "insightAdherencePerfect",
  subjectBehind: "insightSubjectBehind",
  subjectDone: "insightSubjectDone",
  lowCompletion: "insightLowCompletion",
  highCompletion: "insightHighCompletion",
};

const I18N = {
  en: {
    eyebrow: "STUDY ANALYTICS",
    backToTimer: "← Back to timer",
    connectTitle: "Connect your study data",
    connectBody: "Open the same study-data.json file you use in the timer to see your stats here.",
    openFile: "Open Data File",
    importJson: "Import JSON",
    refresh: "Refresh",
    changeFile: "Change file",
    noFileApi: "This browser can't open files directly. Use Import JSON instead.",
    readFailed: "Could not read the file",
    invalidFile: "Invalid study data file",
    noPermission: "Permission to access the file was denied",
    refreshed: "Refreshed",
    noSessionsYet: "No finished study sessions yet — come back after your first session.",
    overviewTitle: "Overview",
    totalStudyTime: "Total study time",
    currentStreak: "Current streak",
    completionRate: "Completion rate",
    avgSession: "Avg. session",
    goalDays: "Goal days (30d)",
    bestDay: "Best day (30d)",
    breakTime: "Break time",
    sessions: "sessions",
    longest: "longest",
    noGoalSet: "no goal set",
    ofTotalTime: "of total time",
    completed: "completed",
    abandoned: "abandoned",
    days: "days",
    day: "day",
    last30Days: "Last 30 Days",
    weeklyTrend: "Weekly Trend",
    sessionOutcomes: "Session Outcomes",
    goalLineLegend: "Daily goal",
    completedLabel: "Completed",
    abandonedLabel: "Abandoned",
    cancelledLabel: "Cancelled",
    subjectsTitle: "Subjects",
    noSubjectsYet: "No subjects yet",
    examCountdown: "EXAM COUNTDOWN",
    daysLeftLabel: "DAYS LEFT",
    todayStatus: "TODAY",
    setExamDates:
      "Set your study start date and exam date in the timer's Settings to activate the countdown.",
    weekWord: "Week",
    daysPassedSuffix: "days passed",
    daysLeftSuffix: "days left",
    daypartTitle: "Time of Day",
    morning: "Morning",
    afternoon: "Afternoon",
    evening: "Evening",
    night: "Night",
    weekdayTitle: "Study by Day of Week",
    sessionLengthTitle: "Session Lengths",
    subjectShareTitle: "Subject Share",
    pauseBreakTitle: "Study vs Break vs Idle",
    studyLabel: "Study",
    pausedLabel: "Idle (paused)",
    monthlyTitle: "Monthly Overview",

    // Weekly plan
    weeklyPlanTitle: "Weekly Plan",
    connectWeeklyPlan: "Open Plan File",
    weeklyPlanNotConnected: "Open your weekly-plans.json file to see plan adherence here.",
    weeklyPlanNeedStudyData: "Connect your study data file too, so actual time can be compared to the plan.",
    weeklyPlanStatusConnected: "Connected",
    weeklyPlanStatusPermission: "Needs reconnect — click Open Plan File",
    weeklyPlanStatusDisconnected: "Not connected",
    weeklyPlanStatusUnsupported: "This browser can't open files directly",
    adherenceTrendTitle: "Plan Adherence by Week",
    currentWeekTitle: "This Week: Planned vs Actual",
    plannedLabel: "Planned",
    actualLabel: "Actual",
    noWeeklyPlanWeeks: "No completed plan weeks yet",
    noCurrentWeekPlan: "No plan for this week",
    planAdherence: "Plan adherence",
    weeksTracked: "weeks tracked",

    // Insights
    insightsTitle: "Insights",
    noInsights: "Not enough data yet for insights.",
    insightStreakGood: "You\u2019re on a {days}-day study streak \u2014 keep it going.",
    insightStreakBroken: "Your streak ended. Your longest run was {longest} days \u2014 try to beat it.",
    insightAdherenceUp: "Plan adherence improved to {pct}% last tracked week.",
    insightAdherenceDown: "Plan adherence dropped to {pct}% last tracked week.",
    insightAdherenceLow:
      "Last tracked week\u2019s plan adherence was only {pct}% \u2014 consider a lighter plan.",
    insightAdherencePerfect: "You fully completed last tracked week\u2019s plan ({pct}%). Nice work.",
    insightSubjectBehind: "{subject} is falling behind this week ({pct}% done).",
    insightSubjectDone: "You\u2019ve already hit this week\u2019s goal for {subject}.",
    insightLowCompletion: "Only {pct}% of your sessions finish as planned \u2014 try shorter sessions.",
    insightHighCompletion: "{pct}% of your sessions finish as planned \u2014 strong consistency.",

    // WeeklyPlanStore toast keys (hooks.onMessage)
    toastSaveFailed: "Could not save the file",
    toastFileCreated: "File created",
    toastInvalid: "Invalid weekly plans file",
    toastFileLoaded: "Weekly plan file loaded",
    toastImported: "Imported",
    toastExported: "Exported",
    toastNoFileApi: "This browser can't open files directly",
    toastNoPermission: "Permission to access the file was denied",
    toastReadFailed: "Could not read the file",
  },
  fa: {
    eyebrow: "تحلیل مطالعه",
    backToTimer: "← بازگشت به تایمر",
    connectTitle: "فایل داده‌های مطالعه را متصل کنید",
    connectBody:
      "همان فایل study-data.json که در تایمر استفاده می‌کنید را باز کنید تا آمار اینجا نمایش داده شود.",
    openFile: "باز کردن فایل داده",
    importJson: "ورود JSON",
    refresh: "به‌روزرسانی",
    changeFile: "تغییر فایل",
    noFileApi: "این مرورگر امکان باز کردن مستقیم فایل را ندارد. از ورود JSON استفاده کنید.",
    readFailed: "خواندن فایل ناموفق بود",
    invalidFile: "فایل داده نامعتبر است",
    noPermission: "دسترسی به فایل داده نشد",
    refreshed: "به‌روزرسانی شد",
    noSessionsYet: "هنوز جلسه‌ی مطالعه‌ی تمام‌شده‌ای ثبت نشده — بعد از اولین جلسه دوباره سر بزنید.",
    overviewTitle: "نمای کلی",
    totalStudyTime: "کل زمان مطالعه",
    currentStreak: "روزهای متوالی فعلی",
    completionRate: "نرخ تکمیل",
    avgSession: "میانگین جلسه",
    goalDays: "روزهای هدف (۳۰ روز)",
    bestDay: "بهترین روز (۳۰ روز)",
    breakTime: "زمان استراحت",
    sessions: "جلسه",
    longest: "بیشترین",
    noGoalSet: "هدفی تعیین نشده",
    ofTotalTime: "از کل زمان",
    completed: "کامل",
    abandoned: "ناتمام",
    days: "روز",
    day: "روز",
    last30Days: "۳۰ روز اخیر",
    weeklyTrend: "روند هفتگی",
    sessionOutcomes: "نتیجه‌ی جلسات",
    goalLineLegend: "هدف روزانه",
    completedLabel: "کامل‌شده",
    abandonedLabel: "ناتمام",
    cancelledLabel: "لغوشده",
    subjectsTitle: "دروس",
    noSubjectsYet: "هنوز درسی ثبت نشده",
    examCountdown: "شمارش معکوس امتحان",
    daysLeftLabel: "روز مانده",
    todayStatus: "امروز",
    setExamDates: "تاریخ شروع مطالعه و تاریخ امتحان را در تنظیمات تایمر مشخص کنید تا شمارش معکوس فعال شود.",
    weekWord: "هفته",
    daysPassedSuffix: "روز گذشته",
    daysLeftSuffix: "روز مانده",
    daypartTitle: "توزیع ساعت مطالعه",
    morning: "صبح",
    afternoon: "ظهر",
    evening: "عصر",
    night: "شب",
    weekdayTitle: "مطالعه بر حسب روز هفته",
    sessionLengthTitle: "توزیع طول جلسات",
    subjectShareTitle: "سهم دروس",
    pauseBreakTitle: "مطالعه / استراحت / مکث",
    studyLabel: "مطالعه",
    pausedLabel: "مکث‌شده",
    monthlyTitle: "نمای ماهانه",

    // Weekly plan
    weeklyPlanTitle: "برنامه هفتگی",
    connectWeeklyPlan: "باز کردن فایل برنامه",
    weeklyPlanNotConnected: "فایل weekly-plans.json را باز کنید تا میزان رعایت برنامه اینجا نمایش داده شود.",
    weeklyPlanNeedStudyData: "فایل داده‌های مطالعه را هم متصل کنید تا زمان واقعی با برنامه مقایسه شود.",
    weeklyPlanStatusConnected: "متصل",
    weeklyPlanStatusPermission: "نیاز به اتصال مجدد — روی «باز کردن فایل برنامه» کلیک کنید",
    weeklyPlanStatusDisconnected: "متصل نیست",
    weeklyPlanStatusUnsupported: "این مرورگر امکان باز کردن مستقیم فایل را ندارد",
    adherenceTrendTitle: "رعایت برنامه به تفکیک هفته",
    currentWeekTitle: "این هفته: برنامه‌ریزی‌شده در مقابل واقعی",
    plannedLabel: "برنامه‌ریزی‌شده",
    actualLabel: "واقعی",
    noWeeklyPlanWeeks: "هنوز هیچ هفته‌ی تمام‌شده‌ای در برنامه ثبت نشده",
    noCurrentWeekPlan: "برای این هفته برنامه‌ای وجود ندارد",
    planAdherence: "رعایت برنامه",
    weeksTracked: "هفته ثبت‌شده",

    // Insights
    insightsTitle: "تحلیل کلی",
    noInsights: "هنوز داده‌ی کافی برای تحلیل وجود ندارد.",
    insightStreakGood: "{days} روز پیاپی مطالعه کرده‌ای — همین‌طور ادامه بده.",
    insightStreakBroken: "روند پیاپی‌ات قطع شد. بلندترین رکوردت {longest} روز بوده — سعی کن ازش رد بشی.",
    insightAdherenceUp: "رعایت برنامه در آخرین هفته‌ی ثبت‌شده به {pct}٪ رسیده و بهتر شده.",
    insightAdherenceDown: "رعایت برنامه در آخرین هفته‌ی ثبت‌شده به {pct}٪ افت کرده.",
    insightAdherenceLow:
      "رعایت برنامه در آخرین هفته‌ی ثبت‌شده فقط {pct}٪ بوده — شاید بهتره برنامه سبک‌تری بچینی.",
    insightAdherencePerfect: "برنامه‌ی آخرین هفته رو کامل ({pct}٪) انجام دادی. عالیه.",
    insightSubjectBehind: "درس {subject} این هفته عقب افتاده (فقط {pct}٪ انجام شده).",
    insightSubjectDone: "هدف این هفته برای درس {subject} رو کامل انجام دادی.",
    insightLowCompletion: "فقط {pct}٪ از جلسات طبق برنامه تموم می‌شن — جلسات کوتاه‌تری امتحان کن.",
    insightHighCompletion: "{pct}٪ از جلسات طبق برنامه تموم می‌شن — ثبات خوبی داری.",

    // WeeklyPlanStore toast keys (hooks.onMessage)
    toastSaveFailed: "ذخیره فایل ناموفق بود",
    toastFileCreated: "فایل ساخته شد",
    toastInvalid: "فایل برنامه هفتگی نامعتبر است",
    toastFileLoaded: "فایل برنامه هفتگی بارگذاری شد",
    toastImported: "وارد شد",
    toastExported: "خروجی گرفته شد",
    toastNoFileApi: "این مرورگر امکان باز کردن مستقیم فایل را ندارد",
    toastNoPermission: "دسترسی به فایل داده نشد",
    toastReadFailed: "خواندن فایل ناموفق بود",
  },
};

const el = {
  analyticsHero: $("analyticsHero"),
  kpiGrid: $("kpiGrid"),
  activityHeatmap: $("activityHeatmap"),
  heatmapLegend: $("heatmapLegend"),
  hourChart: $("hourChart"),
  analyticsExam: $("analyticsExam"),
  weeklyChartHint: $("weeklyChartHint"),
  subjectStatsHint: $("subjectStatsHint"),
  weeklyPlanSection: $("weeklyPlanSection"),
  langFaBtn: $("aLangFaBtn"),
  langEnBtn: $("aLangEnBtn"),
  themeToggle: $("aThemeToggle"),

  connectSection: $("connectSection"),
  connectBody: $("connectBody"),
  openFileBtn: $("openFileBtn"),
  importFileInput: $("importFileInput"),

  contentSection: $("contentSection"),
  fileNameLabel: $("fileNameLabel"),
  refreshBtn: $("refreshBtn"),
  changeFileBtn: $("changeFileBtn"),

  emptyState: $("emptyState"),
  overviewSection: $("overviewSection"),
  statsGrid: $("statsGrid"),

  statTotalTime: $("statTotalTime"),
  statTotalTimeMeta: $("statTotalTimeMeta"),
  statStreak: $("statStreak"),
  statStreakMeta: $("statStreakMeta"),
  statCompletion: $("statCompletion"),
  statCompletionMeta: $("statCompletionMeta"),
  statAvgSession: $("statAvgSession"),
  statAvgSessionMeta: $("statAvgSessionMeta"),
  statGoalDays: $("statGoalDays"),
  statGoalDaysMeta: $("statGoalDaysMeta"),
  statBestDay: $("statBestDay"),
  statBestDayMeta: $("statBestDayMeta"),
  statBreakTime: $("statBreakTime"),
  statBreakTimeMeta: $("statBreakTimeMeta"),
  statPlanAdherence: $("statPlanAdherence"),
  statPlanAdherenceMeta: $("statPlanAdherenceMeta"),

  subjectStats: $("subjectStats"),

  examDaysLeft: $("aExamDaysLeft"),
  examMeta: $("aExamMeta"),
  examWeekLabel: $("aExamWeekLabel"),
  examDaysPassed: $("aExamDaysPassed"),
  examDaysLeftMini: $("aExamDaysLeftMini"),
  examProgress: $("aExamProgress"),
  examProgressFill: $("aExamProgressFill"),
  examEmptyNote: $("aExamEmptyNote"),
  examStatusGrid: $("aExamStatusGrid"),
  dailyStatusValue: $("aDailyStatusValue"),
  weeklyStatusTitle: $("aWeeklyStatusTitle"),
  weeklyStatusValue: $("aWeeklyStatusValue"),

  chartsGrid: $("chartsGrid"),
  dailyChart: $("dailyChart"),
  weeklyChart: $("weeklyChart"),
  donutChart: $("donutChart"),
  donutLegend: $("donutLegend"),

  daypartChart: $("daypartChart"),
  weekdayChart: $("weekdayChart"),
  sessionLengthChart: $("sessionLengthChart"),
  subjectDonutChart: $("subjectDonutChart"),
  subjectDonutLegend: $("subjectDonutLegend"),
  pauseDonutChart: $("pauseDonutChart"),
  pauseDonutLegend: $("pauseDonutLegend"),

  monthlySection: $("monthlySection"),
  monthlyChart: $("monthlyChart"),

  // Weekly plan
  weeklyPlanStatusLabel: $("weeklyPlanStatusLabel"),
  weeklyPlanConnectBtn: $("weeklyPlanConnectBtn"),
  weeklyPlanEmptyState: $("weeklyPlanEmptyState"),
  weeklyPlanContent: $("weeklyPlanContent"),
  weeklyPlanAdherenceChart: $("weeklyPlanAdherenceChart"),
  weeklyPlanCurrentWeekList: $("weeklyPlanCurrentWeekList"),

  // Insights
  insightsList: $("insightsList"),
  insightsEmpty: $("insightsEmpty"),

  toast: $("toast"),
  toastText: $("toastText"),
};

/* ------------------------------------------------------------
   Local (display-only) prefs
   ------------------------------------------------------------ */

/* ============================================================
   HERO
   ============================================================ */

function renderHero(stats, streaks, examStatus) {
  if (!el.analyticsHero) return;

  const totalHours = Math.floor(stats.totalStudySeconds / 3600);
  const totalMins = Math.floor((stats.totalStudySeconds % 3600) / 60);

  const examDays = examStatus ? examStatus.daysLeft : null;
  const examProgress = examStatus ? examStatus.progressPct : 0;

  const r = 52;
  const circ = 2 * Math.PI * r;
  const offset = circ - (examProgress / 100) * circ;

  el.analyticsHero.innerHTML = `
    <div>
      <div class="analytics-hero__eyebrow">
        <span class="analytics-hero__eyebrow-dot"></span>
        خلاصه‌ی عملکرد
      </div>
      <h1 class="analytics-hero__title">مجموع ${totalHours} ساعت و ${totalMins} دقیقه مطالعه</h1>
      <p class="analytics-hero__subtitle">
        ${stats.totalSessions} جلسه‌ی مطالعه · ${examDays !== null ? `${examDays} روز مانده به کنکور` : "تاریخ کنکور ثبت نشده"}
      </p>
      <div class="analytics-hero__stats">
        <div class="analytics-hero__stat">
          <span class="analytics-hero__stat-label">Streak فعلی</span>
          <span class="analytics-hero__stat-value analytics-hero__stat-value--accent">${streaks.current} روز</span>
        </div>
        <div class="analytics-hero__stat">
          <span class="analytics-hero__stat-label">بلندترین Streak</span>
          <span class="analytics-hero__stat-label" style="color:var(--text-2);font-size:16px;font-family:var(--font-mono);font-weight:800;">${streaks.longest} روز</span>
        </div>
        <div class="analytics-hero__stat">
          <span class="analytics-hero__stat-label">کل جلسات</span>
          <span class="analytics-hero__stat-value">${stats.totalSessions}</span>
        </div>
      </div>
    </div>
    ${
      examStatus
        ? `
      <div class="analytics-hero__ring">
        <svg viewBox="0 0 120 120" class="hero-ring-svg">
          <circle class="hero-ring-bg" cx="60" cy="60" r="${r}" fill="none" stroke-width="7"/>
          <circle class="hero-ring-fg" cx="60" cy="60" r="${r}" fill="none" stroke-width="7"
            stroke-dasharray="${circ}" stroke-dashoffset="${offset}"
            transform="rotate(-90 60 60)" stroke-linecap="round"/>
        </svg>
        <div class="analytics-hero__ring-inner">
          <strong>${examDays}</strong>
          <span>روز مانده</span>
        </div>
      </div>
    `
        : ""
    }
  `;
}

/* ============================================================
   KPI GRID
   ============================================================ */

function kpiCard(icon, label, value, meta) {
  const card = document.createElement("div");
  card.className = "analytics-kpi";
  card.innerHTML = `
    <div class="analytics-kpi__icon">${icon}</div>
    <div class="analytics-kpi__body">
      <span class="analytics-kpi__label">${label}</span>
      <strong class="analytics-kpi__value">${value}</strong>
      ${meta ? `<span class="analytics-kpi__meta">${meta}</span>` : ""}
    </div>
  `;
  return card;
}

function renderKpis(stats, streaks, daily, goalSeconds, avgSeconds, rate, goalDays, best) {
  if (!el.kpiGrid) return;
  el.kpiGrid.innerHTML = "";

  const rateText = rate === null ? "—" : `${rate}%`;
  const goalDaysText = goalSeconds > 0 ? `${goalDays}/30` : "—";
  const bestText = best && best.studySeconds > 0 ? fmtHoursMinutes(best.studySeconds) : "—";

  el.kpiGrid.appendChild(
    kpiCard("⏱️", "کل زمان مطالعه", fmtHoursMinutes(stats.totalStudySeconds), `${stats.totalSessions} جلسه`),
  );
  el.kpiGrid.appendChild(
    kpiCard("🔥", "Streak فعلی", `${streaks.current} روز`, `بلندترین: ${streaks.longest} روز`),
  );
  el.kpiGrid.appendChild(
    kpiCard(
      "✅",
      "نرخ تکمیل",
      rateText,
      `${stats.completedSessions} کامل · ${stats.abandonedSessions} ناتمام`,
    ),
  );
  el.kpiGrid.appendChild(
    kpiCard(
      "⏳",
      "میانگین جلسه",
      avgSeconds > 0 ? fmtHoursMinutes(avgSeconds) : "—",
      `${stats.totalSessions} جلسه`,
    ),
  );
  el.kpiGrid.appendChild(
    kpiCard(
      "🎯",
      "روزهای هدف (۳۰ روز)",
      goalDaysText,
      goalSeconds > 0 ? `هدف: ${fmtHoursMinutes(goalSeconds)}` : "هدفی تعیین نشده",
    ),
  );
  el.kpiGrid.appendChild(
    kpiCard(
      "🏆",
      "بهترین روز (۳۰ روز)",
      bestText,
      best && best.studySeconds > 0 ? dayLabel(best.dayKey) : "—",
    ),
  );
  el.kpiGrid.appendChild(
    kpiCard(
      "☕",
      "زمان استراحت",
      fmtHoursMinutes(stats.totalBreakSeconds),
      `${Math.round((stats.totalBreakSeconds / Math.max(1, stats.totalStudySeconds + stats.totalBreakSeconds)) * 100)}% از کل`,
    ),
  );
  el.kpiGrid.appendChild(
    kpiCard("🧘", "زمان مکث", fmtHoursMinutes(stats.totalPausedSeconds), `${stats.totalPauseCount} بار`),
  );
}

/* ============================================================
   HEATMAP
   ============================================================ */

function renderHeatmap(sessions) {
  if (!el.activityHeatmap) return;

  const { weeks } = buildActivityHeatmap(sessions, 91);

  const dayNames = ["ش", "ی", "د", "س", "چ", "پ", "ج"];

  el.activityHeatmap.innerHTML = `
    <div style="display:flex;gap:8px">
      <div style="display:flex;flex-direction:column;gap:3px;padding-top:0">
        ${dayNames.map((n) => `<span style="height:15px;font-size:9px;color:var(--text-3);line-height:15px;text-align:center;width:14px">${n}</span>`).join("")}
      </div>
      <div class="heatmap-grid">
        ${weeks
          .map(
            (week) => `
          <div class="heatmap-week">
            ${week
              .map((cell) => {
                if (!cell.dayKey) return `<div class="heatmap-cell" style="opacity:0"></div>`;
                return `<div class="heatmap-cell heatmap-cell--l${cell.level}" title="${cell.dayKey}: ${fmtHoursMinutes(cell.seconds)}"></div>`;
              })
              .join("")}
          </div>
        `,
          )
          .join("")}
      </div>
    </div>
  `;

  if (el.heatmapLegend) {
    el.heatmapLegend.innerHTML = `
      <span class="heatmap-legend__label">کم</span>
      ${[0, 1, 2, 3, 4, 5].map((l) => `<span class="heatmap-legend__swatch heatmap-cell--l${l}"></span>`).join("")}
      <span class="heatmap-legend__label">زیاد</span>
    `;
  }
}

/* ============================================================
   HOUR-OF-DAY CHART
   ============================================================ */

function renderHourChart(sessions) {
  if (!el.hourChart) return;
  const dist = buildHourOfDayDistribution(sessions);
  const categories = dist.map((d) => ({ label: String(d.hour).padStart(2, "0"), value: d.seconds }));
  el.hourChart.innerHTML =
    renderCategoryBarChart(categories, { gap: 4, formatValue: (v) => `${Math.round(v / 60)}m` }) ||
    `<div class="chart-empty">—</div>`;
}

/* ============================================================
   EXAM
   ============================================================ */

function renderExamStatusAnalytics(status) {
  if (!el.analyticsExam) return;
  const t = tr();

  if (!status) {
    el.analyticsExam.innerHTML = `<div class="empty-state">${esc(t.setExamDates)}</div>`;
    return;
  }

  const r = 46;
  const circ = 2 * Math.PI * r;
  const offset = circ - (status.progressPct / 100) * circ;

  el.analyticsExam.innerHTML = `
    <div class="analytics-exam__ring">
      <svg viewBox="0 0 110 110" class="hero-ring-svg">
        <circle class="hero-ring-bg" cx="55" cy="55" r="${r}" fill="none" stroke-width="7"/>
        <circle class="hero-ring-fg" cx="55" cy="55" r="${r}" fill="none" stroke-width="7"
          stroke-dasharray="${circ}" stroke-dashoffset="${offset}"
          transform="rotate(-90 55 55)" stroke-linecap="round"/>
      </svg>
      <div class="analytics-exam__ring-inner">
        <strong>${status.daysLeft}</strong>
        <span>روز مانده</span>
      </div>
    </div>
    <div class="analytics-exam__info">
      <div class="analytics-exam__row">
        <span class="analytics-exam__row-label">هفته‌ی فعلی</span>
        <span class="analytics-exam__row-value">${status.currentWeek} / ${status.totalWeeks}</span>
      </div>
      <div class="analytics-exam__row">
        <span class="analytics-exam__row-label">روزهای گذشته</span>
        <span class="analytics-exam__row-value">${status.daysPassed} از ${status.totalPlanDays}</span>
      </div>
      <div class="analytics-exam__row">
        <span class="analytics-exam__row-label">پیشرفت کلی</span>
        <span class="analytics-exam__row-value">${status.progressPct}%</span>
      </div>
      <div class="analytics-exam__row">
        <span class="analytics-exam__row-label">مطالعه امروز</span>
        <span class="analytics-exam__row-value">${fmtHoursMinutes(status.todaySeconds)}</span>
      </div>
      <div class="analytics-exam__row">
        <span class="analytics-exam__row-label">این هفته</span>
        <span class="analytics-exam__row-value">${fmtHoursMinutes(status.weekSeconds)} / ${fmtHoursMinutes(status.weekGoalSeconds)}</span>
      </div>
    </div>
  `;
}

/* ============================================================
   WEEKLY HINT
   ============================================================ */

function renderWeeklyHint(weekly) {
  if (!el.weeklyChartHint) return;
  const total = weekly.reduce((s, b) => s + b.studySeconds, 0);
  const avg = Math.round(total / weekly.length);
  el.weeklyChartHint.textContent = `میانگین: ${fmtHoursMinutes(avg)} در هفته`;
}

function readLocalPrefs() {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_PREFS_KEY)) || {};
  } catch {
    return {};
  }
}

function writeLocalPrefs(prefs) {
  try {
    localStorage.setItem(LOCAL_PREFS_KEY, JSON.stringify(prefs));
  } catch {
    /* best-effort only */
  }
}

let prefs = { language: "en", theme: "dark", ...readLocalPrefs() };

function tr() {
  return I18N[prefs.language] || I18N.en;
}

function lang() {
  return prefs.language === "fa" ? "fa" : "en";
}

function applyLanguage() {
  document.documentElement.lang = prefs.language;
  document.documentElement.dir = prefs.language === "fa" ? "rtl" : "ltr";
  document.body.dataset.lang = prefs.language;
  el.langFaBtn.classList.toggle("is-active", prefs.language === "fa");
  el.langEnBtn.classList.toggle("is-active", prefs.language === "en");
}

function applyTheme() {
  document.body.setAttribute("data-theme", prefs.theme);
}

function renderTranslations() {
  const t = tr();
  document.querySelectorAll("[data-i18n]").forEach((node) => {
    const text = t[node.dataset.i18n];
    if (text) node.textContent = text;
  });
}

function setLanguage(lang) {
  if (lang !== "fa" && lang !== "en") return;
  prefs.language = lang;
  writeLocalPrefs(prefs);
  applyLanguage();
  renderTranslations();
  if (currentDoc)
    renderAnalytics(currentDoc); // re-render number/date strings + chart tooltips
  else renderWeeklyPlanSection(); // plan-only view still needs its labels refreshed
}

function toggleTheme() {
  prefs.theme = prefs.theme === "dark" ? "light" : "dark";
  writeLocalPrefs(prefs);
  applyTheme();
}

/* ------------------------------------------------------------
   Toast (same pattern as ui.js: toggle [hidden], no timers overlap)
   ------------------------------------------------------------ */

let toastTimer = null;

function showToast(text, tone = "info") {
  if (!el.toast) return;
  el.toastText.textContent = text;
  el.toast.dataset.tone = tone;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, 4500);
}

/* ------------------------------------------------------------
   File loading (read-only)
   ------------------------------------------------------------ */

let handle = null;
let currentDoc = null;

// Last-computed pieces kept around so weekly-plan / insights rendering
// can react to either file loading independently of the other.
let lastStats = null;
let lastStreaks = null;
let lastSubjectStats = [];
let lastAdherenceWeeks = [];
let lastCurrentWeekComparison = [];

function dayLabel(dayKey) {
  // Keep digits plain (no locale numeral conversion) — matches fmtHoursMinutes/pad elsewhere.
  const [, m, d] = dayKey.split("-");
  return `${d}/${m}`;
}

function monthLabel(monthKey) {
  const [y, m] = monthKey.split("-");
  return `${m}/${y}`;
}

async function readAndRender(h) {
  let text;
  try {
    text = await FileStorage.readText(h);
  } catch (err) {
    console.error(err);
    showToast(tr().readFailed, "error");
    return false;
  }

  let doc;
  try {
    doc = parseDocument(text);
  } catch (err) {
    console.error("Invalid data file:", err);
    const detail = err instanceof DataError ? err.details[0] : err.message;
    showToast(detail || tr().invalidFile, "error");
    return false;
  }

  handle = h;
  currentDoc = doc;
  el.fileNameLabel.textContent = h.name || "";
  showConnected();
  renderAnalytics(doc);
  return true;
}

function importText(text) {
  let doc;
  try {
    doc = parseDocument(text);
  } catch (err) {
    console.error("Invalid import file:", err);
    const detail = err instanceof DataError ? err.details[0] : err.message;
    showToast(detail || tr().invalidFile, "error");
    return;
  }
  handle = null; // imported snapshot only — nothing to refresh against
  currentDoc = doc;
  el.fileNameLabel.textContent = "";
  showConnected();
  renderAnalytics(doc);
}

function showConnected() {
  el.connectSection.hidden = true;
  el.contentSection.hidden = false;
  el.refreshBtn.hidden = !handle;
}

async function pickAndOpen() {
  let h;
  try {
    h = await FileStorage.pickOpenFile();
  } catch (err) {
    if (err && err.name === "AbortError") return; // user cancelled
    console.error(err);
    showToast(tr().readFailed, "error");
    return;
  }
  try {
    if (!(await FileStorage.ensurePermission(h, true))) {
      showToast(tr().noPermission, "error");
      return;
    }
  } catch (err) {
    console.error(err);
    showToast(tr().readFailed, "error");
    return;
  }
  if (await readAndRender(h)) {
    await FileStorage.saveHandle(h); // share the remembered file with the timer page too
  }
}

async function refresh() {
  if (!handle) return;
  try {
    if (!(await FileStorage.ensurePermission(handle, false))) {
      showToast(tr().noPermission, "error");
      return;
    }
  } catch (err) {
    console.error(err);
    return;
  }
  if (await readAndRender(handle)) showToast(tr().refreshed, "success");
}

/* ------------------------------------------------------------
   Subjects panel — leaderboard-style rows (name/time, comparison
   bar relative to the top subject, % of total study time)
   ------------------------------------------------------------ */

function renderSubjectStats(items, totalStudySeconds) {
  if (!el.subjectStats) return;
  const t = tr();

  if (!items.length) {
    el.subjectStats.innerHTML = `<div class="empty-state analytics-empty">${esc(t.noSubjectsYet)}</div>`;
    return;
  }

  const maxSeconds = Math.max(1, ...items.map((i) => i.studySeconds));

  el.subjectStats.innerHTML = items
    .map((item) => {
      const time = item.studySeconds > 0 ? fmtHoursMinutes(item.studySeconds) : "—";
      const pct = totalStudySeconds > 0 ? Math.round((item.studySeconds / totalStudySeconds) * 100) : 0;
      const barPct = Math.round((item.studySeconds / maxSeconds) * 100);
      return `
        <div class="subject-row">
          <div class="stat-item">
            <span class="stat-item__label">${esc(item.subject)}</span>
            <strong class="stat-item__value">${time}</strong>
          </div>
          <div class="progress-bar">
            <div class="progress-bar__fill" style="width: ${barPct}%"></div>
          </div>
          <span class="stat-card__meta">${pct}% ${esc(t.ofTotalTime)} · ${item.sessionCount} ${esc(t.sessions)}</span>
        </div>
      `;
    })
    .join("");
}

function renderSubjectDonut(subjectStats) {
  if (!el.subjectDonutChart) return;

  const withTime = subjectStats.filter((s) => s.studySeconds > 0);
  if (!withTime.length) {
    el.subjectDonutChart.innerHTML = `<div class="chart-empty">—</div>`;
    el.subjectDonutLegend.innerHTML = "";
    return;
  }

  const colors = categoricalPalette(withTime.length);
  const total = withTime.reduce((sum, s) => sum + s.studySeconds, 0);
  const segments = withTime.map((s, i) => ({
    value: s.studySeconds,
    label: s.subject,
    color: colors[i],
  }));

  el.subjectDonutChart.innerHTML = renderDonutChart(segments) || `<div class="chart-empty">—</div>`;
  el.subjectDonutLegend.innerHTML = segments
    .map((seg) => {
      const pct = Math.round((seg.value / total) * 100);
      return `<span class="chart-legend__item"><span class="chart-legend__swatch" style="background:${seg.color}"></span>${esc(seg.label)} · ${pct}%</span>`;
    })
    .join("");
}

/* ------------------------------------------------------------
   Exam plan panel
   ------------------------------------------------------------ */

function renderExamStatus(doc) {
  if (!el.examDaysLeft) return;
  const t = tr();
  const status = buildExamPlanStatus(doc.studyPlan, doc.sessions || []);

  if (!status) {
    el.examMeta.hidden = true;
    el.examProgress.hidden = true;
    el.examStatusGrid.hidden = true;
    el.examEmptyNote.hidden = false;
    el.examDaysLeft.textContent = "—";
    return;
  }

  el.examMeta.hidden = false;
  el.examProgress.hidden = false;
  el.examStatusGrid.hidden = false;
  el.examEmptyNote.hidden = true;

  el.examDaysLeft.textContent = status.daysLeft;
  el.examWeekLabel.textContent =
    status.currentWeek != null ? `${t.weekWord} ${status.currentWeek} / ${status.totalWeeks}` : "—";
  el.examDaysPassed.textContent = `${status.daysPassed} ${t.daysPassedSuffix}`;
  el.examDaysLeftMini.textContent = `${status.daysLeft} ${t.daysLeftSuffix}`;
  el.examProgressFill.style.width = `${status.progressPct}%`;

  el.dailyStatusValue.textContent =
    status.goalSeconds > 0
      ? `${fmtHoursMinutes(status.todaySeconds)} / ${fmtHoursMinutes(status.goalSeconds)}`
      : fmtHoursMinutes(status.todaySeconds);

  el.weeklyStatusTitle.textContent =
    status.currentWeek != null
      ? `${t.weekWord.toUpperCase()} ${status.currentWeek}`
      : t.weekWord.toUpperCase();
  el.weeklyStatusValue.textContent =
    status.weekGoalSeconds > 0
      ? `${fmtHoursMinutes(status.weekSeconds)} / ${fmtHoursMinutes(status.weekGoalSeconds)}`
      : fmtHoursMinutes(status.weekSeconds);
}

/* ------------------------------------------------------------
   New pattern charts: time-of-day, day-of-week, session length,
   study/break/idle split, monthly overview
   ------------------------------------------------------------ */

function renderDaypartChart(sessions) {
  if (!el.daypartChart) return;
  const t = tr();
  const dist = buildDaypartDistribution(sessions);
  const labels = { morning: t.morning, afternoon: t.afternoon, evening: t.evening, night: t.night };
  const categories = dist.map((d) => ({ label: labels[d.key], value: d.seconds }));
  el.daypartChart.innerHTML =
    renderCategoryBarChart(categories, { gap: 24 }) || `<div class="chart-empty">—</div>`;
}

function renderWeekdayChart(sessions) {
  if (!el.weekdayChart) return;
  const l = lang();
  const labels = WEEKDAY_LABELS[l];
  const order = WEEKDAY_DISPLAY_ORDER[l];
  const averages = buildWeekdayAverages(sessions);
  const categories = order.map((w) => ({ label: labels[w], value: averages[w].averageSeconds }));
  el.weekdayChart.innerHTML =
    renderCategoryBarChart(categories, { gap: 8 }) || `<div class="chart-empty">—</div>`;
}

function renderSessionLengthChart(sessions) {
  if (!el.sessionLengthChart) return;
  const labels = SESSION_LENGTH_LABELS[lang()];
  const dist = buildSessionLengthDistribution(sessions);
  const categories = dist.map((d, i) => ({ label: labels[i], value: d.count }));
  el.sessionLengthChart.innerHTML =
    renderCategoryBarChart(categories, {
      gap: 24,
      formatValue: (v) => String(Math.round(v)),
      formatTooltip: (c) => `${c.label}: ${c.value}`,
    }) || `<div class="chart-empty">—</div>`;
}

function renderOutcomeDonut(stats) {
  if (!el.donutChart) return;
  const t = tr();
  const segments = [
    { value: stats.completedSessions, className: "chart-donut-segment--completed", label: t.completedLabel },
    { value: stats.abandonedSessions, className: "chart-donut-segment--abandoned", label: t.abandonedLabel },
    { value: stats.cancelledSessions, className: "chart-donut-segment--cancelled", label: t.cancelledLabel },
  ];
  el.donutChart.innerHTML = renderDonutChart(segments) || `<div class="chart-empty">—</div>`;
  el.donutLegend.innerHTML = segments
    .map(
      (seg) =>
        `<span class="chart-legend__item"><span class="chart-legend__swatch ${seg.className}"></span>${seg.label} · ${seg.value}</span>`,
    )
    .join("");
}

function renderPauseDonut(stats) {
  if (!el.pauseDonutChart) return;
  const t = tr();
  const segments = [
    {
      value: stats.totalStudySeconds,
      label: t.studyLabel,
      className: "chart-donut-segment--study",
    },
    { value: stats.totalBreakSeconds, label: t.breakTime, className: "chart-donut-segment--break" },
    {
      value: stats.totalPausedSeconds,
      label: t.pausedLabel,
      className: "chart-donut-segment--paused",
    },
  ];
  el.pauseDonutChart.innerHTML = renderDonutChart(segments) || `<div class="chart-empty">—</div>`;
  const total = segments.reduce((sum, seg) => sum + seg.value, 0);
  el.pauseDonutLegend.innerHTML = segments
    .filter((seg) => seg.value > 0)
    .map((seg) => {
      const pct = total > 0 ? Math.round((seg.value / total) * 100) : 0;
      return `<span class="chart-legend__item"><span class="chart-legend__swatch ${seg.className}"></span>${esc(seg.label)} · ${pct}%</span>`;
    })
    .join("");
}

function renderMonthlyChart(sessions) {
  if (!el.monthlySection) return;
  const monthly = buildMonthlySeries(sessions);
  if (monthly.length <= 1) {
    el.monthlySection.hidden = true;
    return;
  }
  el.monthlySection.hidden = false;
  const categories = monthly.map((m) => ({ label: monthLabel(m.monthKey), value: m.studySeconds }));
  el.monthlyChart.innerHTML =
    renderCategoryBarChart(categories, { gap: 12 }) || `<div class="chart-empty">—</div>`;
}

/* ------------------------------------------------------------
   Weekly plan panel
   ------------------------------------------------------------ */

function weeklyPlanStatusText() {
  const t = tr();
  switch (WeeklyPlanStore.status.state) {
    case "saved":
    case "saving":
    case "unsaved":
      return `${t.weeklyPlanStatusConnected}${WeeklyPlanStore.status.name ? " · " + WeeklyPlanStore.status.name : ""}`;
    case "permission":
      return t.weeklyPlanStatusPermission;
    case "unsupported":
      return t.weeklyPlanStatusUnsupported;
    default:
      return t.weeklyPlanStatusDisconnected;
  }
}

function renderWeeklyPlanStatus() {
  if (el.weeklyPlanStatusLabel) el.weeklyPlanStatusLabel.textContent = weeklyPlanStatusText();
}

function renderAdherenceChart(adherenceWeeks) {
  if (!el.weeklyPlanAdherenceChart) return;
  const t = tr();
  if (!adherenceWeeks.length) {
    el.weeklyPlanAdherenceChart.innerHTML = `<div class="chart-empty">${esc(t.noWeeklyPlanWeeks)}</div>`;
    return;
  }

  // ✅ داده‌ی اضافی را روی category سوار می‌کنیم تا نیازی به index نباشد
  const categories = adherenceWeeks.map((w) => ({
    label: dayLabel(w.weekStart),
    value: Math.max(0, Math.min(100, w.adherencePct)),
    meta: w,
  }));

  el.weeklyPlanAdherenceChart.innerHTML =
    renderCategoryBarChart(categories, {
      gap: 12,
      formatValue: (v) => `${Math.round(v)}%`,
      formatTooltip: (c) => {
        // ✅ از meta استفاده می‌کنیم، نه از index
        const w = c.meta;
        return `${c.label}: ${w.adherencePct}% (${fmtHoursMinutes(w.actualMinutes * 60)} / ${fmtHoursMinutes(w.plannedMinutes * 60)})`;
      },
    }) || `<div class="chart-empty">—</div>`;
}

function renderCurrentWeekComparison(items) {
  if (!el.weeklyPlanCurrentWeekList) return;
  const t = tr();
  if (!items.length) {
    el.weeklyPlanCurrentWeekList.innerHTML = `<div class="empty-state analytics-empty">${esc(t.noCurrentWeekPlan)}</div>`;
    return;
  }
  const maxMinutes = Math.max(1, ...items.map((i) => Math.max(i.plannedMinutes, i.actualMinutes)));
  el.weeklyPlanCurrentWeekList.innerHTML = items
    .map((item) => {
      const barPct = Math.round((item.actualMinutes / maxMinutes) * 100);
      return `
        <div class="subject-row">
          <div class="stat-item">
            <span class="stat-item__label">${esc(item.subject)}</span>
            <strong class="stat-item__value">${fmtHoursMinutes(item.actualMinutes * 60)} / ${fmtHoursMinutes(item.plannedMinutes * 60)}</strong>
          </div>
          <div class="progress-bar">
            <div class="progress-bar__fill" style="width: ${Math.min(100, barPct)}%"></div>
          </div>
          <span class="stat-card__meta">${item.pct}% ${esc(t.actualLabel)} / ${esc(t.plannedLabel)}</span>
        </div>
      `;
    })
    .join("");
}

function renderPlanAdherenceStat(adherenceWeeks) {
  if (!el.statPlanAdherence) return;
  const t = tr();
  if (!adherenceWeeks.length) {
    el.statPlanAdherence.textContent = "—";
    el.statPlanAdherenceMeta.textContent = t.noWeeklyPlanWeeks;
    return;
  }
  const avg = Math.round(
    adherenceWeeks.reduce((sum, w) => sum + Math.min(100, w.adherencePct), 0) / adherenceWeeks.length,
  );
  el.statPlanAdherence.textContent = `${avg}%`;
  el.statPlanAdherenceMeta.textContent = `${adherenceWeeks.length} ${t.weeksTracked}`;
}

/** Renders (or re-renders) everything weekly-plan-related, using whichever
    of {plan doc, study doc} are currently loaded — either, both, or neither. */
function renderWeeklyPlanSection() {
  if (!el.weeklyPlanContent) return;
  const t = tr();
  renderWeeklyPlanStatus();

  const hasPlanData = WeeklyPlanStore.hasData();

  if (!hasPlanData) {
    el.weeklyPlanContent.hidden = true;
    if (el.weeklyPlanEmptyState) {
      el.weeklyPlanEmptyState.hidden = false;
      el.weeklyPlanEmptyState.textContent = t.weeklyPlanNotConnected;
    }
    lastAdherenceWeeks = [];
    lastCurrentWeekComparison = [];
    renderPlanAdherenceStat([]);
    renderInsights();
    return;
  }

  if (!currentDoc) {
    el.weeklyPlanContent.hidden = true;
    if (el.weeklyPlanEmptyState) {
      el.weeklyPlanEmptyState.hidden = false;
      el.weeklyPlanEmptyState.textContent = t.weeklyPlanNeedStudyData;
    }
    lastAdherenceWeeks = [];
    lastCurrentWeekComparison = [];
    renderPlanAdherenceStat([]);
    renderInsights();
    return;
  }

  if (el.weeklyPlanEmptyState) el.weeklyPlanEmptyState.hidden = true;
  el.weeklyPlanContent.hidden = false;

  const sessions = currentDoc.sessions || [];
  const plans = WeeklyPlanStore.getWeeks();

  lastAdherenceWeeks = buildWeeklyPlanAdherence(plans, sessions);
  lastCurrentWeekComparison = buildCurrentWeekPlanComparison(plans, sessions);

  renderAdherenceChart(lastAdherenceWeeks);
  renderCurrentWeekComparison(lastCurrentWeekComparison);
  renderPlanAdherenceStat(lastAdherenceWeeks);
  renderInsights();
}

/* ------------------------------------------------------------
   Insights panel
   ------------------------------------------------------------ */

function fillTemplate(str, vars) {
  return str.replace(/\{(\w+)\}/g, (_, k) => (k in vars ? String(vars[k]) : ""));
}

function renderInsights() {
  if (!el.insightsList) return;
  const t = tr();

  const insights = buildInsights({
    stats: lastStats,
    streaks: lastStreaks,
    subjectStats: lastSubjectStats,
    adherenceWeeks: lastAdherenceWeeks,
    currentWeekComparison: lastCurrentWeekComparison,
  });

  if (!insights.length) {
    el.insightsList.innerHTML = "";
    if (el.insightsEmpty) el.insightsEmpty.hidden = false;
    return;
  }
  if (el.insightsEmpty) el.insightsEmpty.hidden = true;

  el.insightsList.innerHTML = insights
    .map((ins) => {
      const key = INSIGHT_KEY[ins.type];
      const template = key && t[key];
      if (!template) return "";
      return `<li class="insight-item">${esc(fillTemplate(template, ins))}</li>`;
    })
    .join("");
}

/* ------------------------------------------------------------
   Rendering
   ------------------------------------------------------------ */

function renderAnalytics(doc) {
  const t = tr();
  const sessions = doc.sessions || [];
  const subjects = doc.subjects || [];

  const stats = buildOverallStats(sessions);
  const streaks = buildStreaks(sessions);
  const examStatus = buildExamPlanStatus(doc.studyPlan, sessions);

  // Hero (always shown)
  renderHero(stats, streaks, examStatus);

  // Exam (always shown)
  renderExamStatusAnalytics(examStatus);

  // No sessions yet → empty
  const finishedStudy = stats.completedSessions + stats.abandonedSessions + stats.cancelledSessions;
  if (finishedStudy === 0) {
    el.emptyState.hidden = false;
    el.kpiGrid.innerHTML = "";
    el.activityHeatmap.innerHTML = "";
    el.dailyChart.innerHTML = "";
    el.weeklyChart.innerHTML = "";
    el.subjectStats.innerHTML = "";
    el.subjectDonutChart.innerHTML = "";
    el.subjectDonutLegend.innerHTML = "";
    el.donutChart.innerHTML = "";
    el.donutLegend.innerHTML = "";
    el.pauseDonutChart.innerHTML = "";
    el.pauseDonutLegend.innerHTML = "";
    el.daypartChart.innerHTML = "";
    el.weekdayChart.innerHTML = "";
    el.hourChart.innerHTML = "";
    el.sessionLengthChart.innerHTML = "";
    el.monthlySection.hidden = true;
    if (el.insightsList) el.insightsList.innerHTML = "";
    if (el.insightsEmpty) el.insightsEmpty.hidden = false;
    renderWeeklyPlanSection();
    return;
  }
  el.emptyState.hidden = true;

  // KPIs
  const daily = buildDailySeries(sessions, DAILY_WINDOW_DAYS);
  const weekly = buildWeeklySeries(sessions, WEEKLY_WINDOW_WEEKS);
  const best = bestDayOf(daily);
  const goalSeconds = (doc.studyPlan.dailyGoalMinutes || 0) * 60;
  const metDays = goalDaysCount(daily, goalSeconds);
  const avgSeconds = averageSessionSeconds(stats);
  const rate = completionRatePercent(stats);

  renderKpis(stats, streaks, daily, goalSeconds, avgSeconds, rate, metDays, best);
  renderHeatmap(sessions);

  // Daily / Weekly
  el.dailyChart.innerHTML = renderBarChart(daily, { goalSeconds }) || `<div class="chart-empty">—</div>`;
  el.weeklyChart.innerHTML = renderLineChart(weekly) || `<div class="chart-empty">—</div>`;
  renderWeeklyHint(weekly);

  // Subjects
  const subjectStats = buildSubjectStats(sessions, subjects);
  renderSubjectStats(subjectStats, stats.totalStudySeconds);
  renderSubjectDonut(subjectStats);

  // Time pattern
  renderDaypartChart(sessions);
  renderWeekdayChart(sessions);
  renderHourChart(sessions);

  // Session quality
  renderSessionLengthChart(sessions);
  renderOutcomeDonut(stats);
  renderPauseDonut(stats);
  renderMonthlyChart(sessions);

  // Insights + weekly plan
  lastStats = stats;
  lastStreaks = streaks;
  lastSubjectStats = subjectStats;
  renderWeeklyPlanSection();
}

/* ------------------------------------------------------------
   Wiring
   ------------------------------------------------------------ */

el.langFaBtn.addEventListener("click", () => setLanguage("fa"));
el.langEnBtn.addEventListener("click", () => setLanguage("en"));
el.themeToggle.addEventListener("click", () => toggleTheme());

el.openFileBtn.addEventListener("click", () => pickAndOpen());
el.changeFileBtn.addEventListener("click", () => pickAndOpen());
el.refreshBtn.addEventListener("click", () => refresh());

el.importFileInput.addEventListener("change", async () => {
  const file = el.importFileInput.files && el.importFileInput.files[0];
  if (!file) return;
  try {
    importText(await file.text());
  } catch (err) {
    console.error(err);
    showToast(tr().readFailed, "error");
  } finally {
    el.importFileInput.value = "";
  }
});

if (el.weeklyPlanConnectBtn) {
  el.weeklyPlanConnectBtn.addEventListener("click", () => {
    if (WeeklyPlanStore.status.state === "permission") WeeklyPlanStore.reconnect();
    else WeeklyPlanStore.openFile();
  });
}

WeeklyPlanStore.hooks.onStatus = () => renderWeeklyPlanStatus();
WeeklyPlanStore.hooks.onMessage = (key, tone, _detail) => {
  const t = tr();
  showToast(t[key] || key, tone);
};
WeeklyPlanStore.hooks.onLoaded = () => renderWeeklyPlanSection();

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */

async function init() {
  applyLanguage();
  applyTheme();
  renderTranslations();

  const supported = FileStorage.isSupported();
  el.openFileBtn.hidden = !supported;
  if (!supported) showToast(tr().noFileApi, "info");

  if (supported) {
    const remembered = await FileStorage.loadHandle();
    if (remembered) {
      try {
        if (await FileStorage.ensurePermission(remembered, false)) {
          await readAndRender(remembered);
        }
        // Permission not yet granted for this reload: leave the connect panel
        // showing "Open Data File" rather than a separate reconnect flow —
        // this page is a secondary, read-only view of the same file.
      } catch (err) {
        console.error(err);
      }
    }
  }

  // Weekly plan is a fully separate file/connection from study data —
  // load it independently so either can be present without the other.
  await WeeklyPlanStore.init();
  renderWeeklyPlanSection();
}

init();
