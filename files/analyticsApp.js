/* =============================================================
   analyticsApp.js  (entry point for analytics.html)

   Read-only view over the same study-data.json used by the timer.
   Never calls FileStorage.writeText — this page only reads.

   Local display prefs (language/theme) are stored separately in
   localStorage under LOCAL_PREFS_KEY and never written back into
   the study data file, so opening this page can't race with the
   timer's own save pipeline (persistence.js).
   ============================================================= */

import { parseDocument, DataError } from './dataLayer.js';
import { FileStorage } from './fileStorage.js';
import { fmtHoursMinutes } from './timer.js';
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
} from './analyticsData.js';
import {
  renderBarChart,
  renderLineChart,
  renderDonutChart,
  renderCategoryBarChart,
  categoricalPalette,
  esc,
} from './analyticsCharts.js';

const $ = (id) => document.getElementById(id);
const LOCAL_PREFS_KEY = 'study-timer:analytics-prefs';
const DAILY_WINDOW_DAYS = 30;
const WEEKLY_WINDOW_WEEKS = 12;

/* Structural (non-translated-dictionary) label sets: order/rotation
   differs by language (week starts Saturday in fa), so these live
   outside I18N rather than as flat string keys. */
const WEEKDAY_LABELS = {
  en: ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  fa: ['یک', 'دو', 'سه', 'چهار', 'پنج', 'جمعه', 'شنبه'],
};
const WEEKDAY_DISPLAY_ORDER = {
  en: [0, 1, 2, 3, 4, 5, 6],
  fa: [6, 0, 1, 2, 3, 4, 5],
};
const SESSION_LENGTH_LABELS = {
  en: ['≤25 min', '26-50 min', '51-90 min', '90+ min'],
  fa: ['≤25 دقیقه', '26-50 دقیقه', '51-90 دقیقه', '90+ دقیقه'],
};

const I18N = {
  en: {
    eyebrow: 'STUDY ANALYTICS',
    backToTimer: '← Back to timer',
    connectTitle: 'Connect your study data',
    connectBody: 'Open the same study-data.json file you use in the timer to see your stats here.',
    openFile: 'Open Data File',
    importJson: 'Import JSON',
    refresh: 'Refresh',
    changeFile: 'Change file',
    noFileApi: "This browser can't open files directly. Use Import JSON instead.",
    readFailed: 'Could not read the file',
    invalidFile: 'Invalid study data file',
    noPermission: 'Permission to access the file was denied',
    refreshed: 'Refreshed',
    noSessionsYet: 'No finished study sessions yet — come back after your first session.',
    overviewTitle: 'Overview',
    totalStudyTime: 'Total study time',
    currentStreak: 'Current streak',
    completionRate: 'Completion rate',
    avgSession: 'Avg. session',
    goalDays: 'Goal days (30d)',
    bestDay: 'Best day (30d)',
    breakTime: 'Break time',
    sessions: 'sessions',
    longest: 'longest',
    noGoalSet: 'no goal set',
    ofTotalTime: 'of total time',
    completed: 'completed',
    abandoned: 'abandoned',
    days: 'days',
    day: 'day',
    last30Days: 'Last 30 Days',
    weeklyTrend: 'Weekly Trend',
    sessionOutcomes: 'Session Outcomes',
    goalLineLegend: 'Daily goal',
    completedLabel: 'Completed',
    abandonedLabel: 'Abandoned',
    cancelledLabel: 'Cancelled',
    subjectsTitle: 'Subjects',
    noSubjectsYet: 'No subjects yet',
    examCountdown: 'EXAM COUNTDOWN',
    daysLeftLabel: 'DAYS LEFT',
    todayStatus: 'TODAY',
    setExamDates:
      "Set your study start date and exam date in the timer's Settings to activate the countdown.",
    weekWord: 'Week',
    daysPassedSuffix: 'days passed',
    daysLeftSuffix: 'days left',
    daypartTitle: 'Time of Day',
    morning: 'Morning',
    afternoon: 'Afternoon',
    evening: 'Evening',
    night: 'Night',
    weekdayTitle: 'Study by Day of Week',
    sessionLengthTitle: 'Session Lengths',
    subjectShareTitle: 'Subject Share',
    pauseBreakTitle: 'Study vs Break vs Idle',
    studyLabel: 'Study',
    pausedLabel: 'Idle (paused)',
    monthlyTitle: 'Monthly Overview',
  },
  fa: {
    eyebrow: 'تحلیل مطالعه',
    backToTimer: '← بازگشت به تایمر',
    connectTitle: 'فایل داده‌های مطالعه را متصل کنید',
    connectBody:
      'همان فایل study-data.json که در تایمر استفاده می‌کنید را باز کنید تا آمار اینجا نمایش داده شود.',
    openFile: 'باز کردن فایل داده',
    importJson: 'ورود JSON',
    refresh: 'به‌روزرسانی',
    changeFile: 'تغییر فایل',
    noFileApi: 'این مرورگر امکان باز کردن مستقیم فایل را ندارد. از ورود JSON استفاده کنید.',
    readFailed: 'خواندن فایل ناموفق بود',
    invalidFile: 'فایل داده نامعتبر است',
    noPermission: 'دسترسی به فایل داده نشد',
    refreshed: 'به‌روزرسانی شد',
    noSessionsYet: 'هنوز جلسه‌ی مطالعه‌ی تمام‌شده‌ای ثبت نشده — بعد از اولین جلسه دوباره سر بزنید.',
    overviewTitle: 'نمای کلی',
    totalStudyTime: 'کل زمان مطالعه',
    currentStreak: 'روزهای متوالی فعلی',
    completionRate: 'نرخ تکمیل',
    avgSession: 'میانگین جلسه',
    goalDays: 'روزهای هدف (۳۰ روز)',
    bestDay: 'بهترین روز (۳۰ روز)',
    breakTime: 'زمان استراحت',
    sessions: 'جلسه',
    longest: 'بیشترین',
    noGoalSet: 'هدفی تعیین نشده',
    ofTotalTime: 'از کل زمان',
    completed: 'کامل',
    abandoned: 'ناتمام',
    days: 'روز',
    day: 'روز',
    last30Days: '۳۰ روز اخیر',
    weeklyTrend: 'روند هفتگی',
    sessionOutcomes: 'نتیجه‌ی جلسات',
    goalLineLegend: 'هدف روزانه',
    completedLabel: 'کامل‌شده',
    abandonedLabel: 'ناتمام',
    cancelledLabel: 'لغوشده',
    subjectsTitle: 'دروس',
    noSubjectsYet: 'هنوز درسی ثبت نشده',
    examCountdown: 'شمارش معکوس امتحان',
    daysLeftLabel: 'روز مانده',
    todayStatus: 'امروز',
    setExamDates:
      'تاریخ شروع مطالعه و تاریخ امتحان را در تنظیمات تایمر مشخص کنید تا شمارش معکوس فعال شود.',
    weekWord: 'هفته',
    daysPassedSuffix: 'روز گذشته',
    daysLeftSuffix: 'روز مانده',
    daypartTitle: 'توزیع ساعت مطالعه',
    morning: 'صبح',
    afternoon: 'ظهر',
    evening: 'عصر',
    night: 'شب',
    weekdayTitle: 'مطالعه بر حسب روز هفته',
    sessionLengthTitle: 'توزیع طول جلسات',
    subjectShareTitle: 'سهم دروس',
    pauseBreakTitle: 'مطالعه / استراحت / مکث',
    studyLabel: 'مطالعه',
    pausedLabel: 'مکث‌شده',
    monthlyTitle: 'نمای ماهانه',
  },
};

const el = {
  langFaBtn: $('aLangFaBtn'),
  langEnBtn: $('aLangEnBtn'),
  themeToggle: $('aThemeToggle'),

  connectSection: $('connectSection'),
  connectBody: $('connectBody'),
  openFileBtn: $('openFileBtn'),
  importFileInput: $('importFileInput'),

  contentSection: $('contentSection'),
  fileNameLabel: $('fileNameLabel'),
  refreshBtn: $('refreshBtn'),
  changeFileBtn: $('changeFileBtn'),

  emptyState: $('emptyState'),
  overviewSection: $('overviewSection'),
  statsGrid: $('statsGrid'),

  statTotalTime: $('statTotalTime'),
  statTotalTimeMeta: $('statTotalTimeMeta'),
  statStreak: $('statStreak'),
  statStreakMeta: $('statStreakMeta'),
  statCompletion: $('statCompletion'),
  statCompletionMeta: $('statCompletionMeta'),
  statAvgSession: $('statAvgSession'),
  statAvgSessionMeta: $('statAvgSessionMeta'),
  statGoalDays: $('statGoalDays'),
  statGoalDaysMeta: $('statGoalDaysMeta'),
  statBestDay: $('statBestDay'),
  statBestDayMeta: $('statBestDayMeta'),
  statBreakTime: $('statBreakTime'),
  statBreakTimeMeta: $('statBreakTimeMeta'),

  subjectStats: $('subjectStats'),

  examDaysLeft: $('aExamDaysLeft'),
  examMeta: $('aExamMeta'),
  examWeekLabel: $('aExamWeekLabel'),
  examDaysPassed: $('aExamDaysPassed'),
  examDaysLeftMini: $('aExamDaysLeftMini'),
  examProgress: $('aExamProgress'),
  examProgressFill: $('aExamProgressFill'),
  examEmptyNote: $('aExamEmptyNote'),
  examStatusGrid: $('aExamStatusGrid'),
  dailyStatusValue: $('aDailyStatusValue'),
  weeklyStatusTitle: $('aWeeklyStatusTitle'),
  weeklyStatusValue: $('aWeeklyStatusValue'),

  chartsGrid: $('chartsGrid'),
  dailyChart: $('dailyChart'),
  weeklyChart: $('weeklyChart'),
  donutChart: $('donutChart'),
  donutLegend: $('donutLegend'),

  daypartChart: $('daypartChart'),
  weekdayChart: $('weekdayChart'),
  sessionLengthChart: $('sessionLengthChart'),
  subjectDonutChart: $('subjectDonutChart'),
  subjectDonutLegend: $('subjectDonutLegend'),
  pauseDonutChart: $('pauseDonutChart'),
  pauseDonutLegend: $('pauseDonutLegend'),

  monthlySection: $('monthlySection'),
  monthlyChart: $('monthlyChart'),

  toast: $('toast'),
  toastText: $('toastText'),
};

/* ------------------------------------------------------------
   Local (display-only) prefs
   ------------------------------------------------------------ */

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

let prefs = { language: 'en', theme: 'dark', ...readLocalPrefs() };

function tr() {
  return I18N[prefs.language] || I18N.en;
}

function lang() {
  return prefs.language === 'fa' ? 'fa' : 'en';
}

function applyLanguage() {
  document.documentElement.lang = prefs.language;
  document.documentElement.dir = prefs.language === 'fa' ? 'rtl' : 'ltr';
  document.body.dataset.lang = prefs.language;
  el.langFaBtn.classList.toggle('is-active', prefs.language === 'fa');
  el.langEnBtn.classList.toggle('is-active', prefs.language === 'en');
}

function applyTheme() {
  document.body.setAttribute('data-theme', prefs.theme);
}

function renderTranslations() {
  const t = tr();
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const text = t[node.dataset.i18n];
    if (text) node.textContent = text;
  });
}

function setLanguage(lang) {
  if (lang !== 'fa' && lang !== 'en') return;
  prefs.language = lang;
  writeLocalPrefs(prefs);
  applyLanguage();
  renderTranslations();
  if (currentDoc) renderAnalytics(currentDoc); // re-render number/date strings + chart tooltips
}

function toggleTheme() {
  prefs.theme = prefs.theme === 'dark' ? 'light' : 'dark';
  writeLocalPrefs(prefs);
  applyTheme();
}

/* ------------------------------------------------------------
   Toast (same pattern as ui.js: toggle [hidden], no timers overlap)
   ------------------------------------------------------------ */

let toastTimer = null;

function showToast(text, tone = 'info') {
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

function dayLabel(dayKey) {
  // Keep digits plain (no locale numeral conversion) — matches fmtHoursMinutes/pad elsewhere.
  const [, m, d] = dayKey.split('-');
  return `${d}/${m}`;
}

function monthLabel(monthKey) {
  const [y, m] = monthKey.split('-');
  return `${m}/${y}`;
}

async function readAndRender(h) {
  let text;
  try {
    text = await FileStorage.readText(h);
  } catch (err) {
    console.error(err);
    showToast(tr().readFailed, 'error');
    return false;
  }

  let doc;
  try {
    doc = parseDocument(text);
  } catch (err) {
    console.error('Invalid data file:', err);
    const detail = err instanceof DataError ? err.details[0] : err.message;
    showToast(detail || tr().invalidFile, 'error');
    return false;
  }

  handle = h;
  currentDoc = doc;
  el.fileNameLabel.textContent = h.name || '';
  showConnected();
  renderAnalytics(doc);
  return true;
}

function importText(text) {
  let doc;
  try {
    doc = parseDocument(text);
  } catch (err) {
    console.error('Invalid import file:', err);
    const detail = err instanceof DataError ? err.details[0] : err.message;
    showToast(detail || tr().invalidFile, 'error');
    return;
  }
  handle = null; // imported snapshot only — nothing to refresh against
  currentDoc = doc;
  el.fileNameLabel.textContent = '';
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
    if (err && err.name === 'AbortError') return; // user cancelled
    console.error(err);
    showToast(tr().readFailed, 'error');
    return;
  }
  try {
    if (!(await FileStorage.ensurePermission(h, true))) {
      showToast(tr().noPermission, 'error');
      return;
    }
  } catch (err) {
    console.error(err);
    showToast(tr().readFailed, 'error');
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
      showToast(tr().noPermission, 'error');
      return;
    }
  } catch (err) {
    console.error(err);
    return;
  }
  if (await readAndRender(handle)) showToast(tr().refreshed, 'success');
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
      const time = item.studySeconds > 0 ? fmtHoursMinutes(item.studySeconds) : '—';
      const pct =
        totalStudySeconds > 0 ? Math.round((item.studySeconds / totalStudySeconds) * 100) : 0;
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
    .join('');
}

function renderSubjectDonut(subjectStats) {
  if (!el.subjectDonutChart) return;

  const withTime = subjectStats.filter((s) => s.studySeconds > 0);
  if (!withTime.length) {
    el.subjectDonutChart.innerHTML = `<div class="chart-empty">—</div>`;
    el.subjectDonutLegend.innerHTML = '';
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
    .join('');
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
    el.examDaysLeft.textContent = '—';
    return;
  }

  el.examMeta.hidden = false;
  el.examProgress.hidden = false;
  el.examStatusGrid.hidden = false;
  el.examEmptyNote.hidden = true;

  el.examDaysLeft.textContent = status.daysLeft;
  el.examWeekLabel.textContent =
    status.currentWeek != null ? `${t.weekWord} ${status.currentWeek} / ${status.totalWeeks}` : '—';
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

function renderPauseDonut(stats) {
  if (!el.pauseDonutChart) return;
  const t = tr();
  const segments = [
    {
      value: stats.totalStudySeconds,
      label: t.studyLabel,
      className: 'chart-donut-segment--study',
    },
    { value: stats.totalBreakSeconds, label: t.breakTime, className: 'chart-donut-segment--break' },
    {
      value: stats.totalPausedSeconds,
      label: t.pausedLabel,
      className: 'chart-donut-segment--paused',
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
    .join('');
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
   Rendering
   ------------------------------------------------------------ */

function renderAnalytics(doc) {
  const t = tr();
  const sessions = doc.sessions || [];
  const subjects = doc.subjects || [];

  renderExamStatus(doc);

  const stats = buildOverallStats(sessions);
  const subjectStats = buildSubjectStats(sessions, subjects);
  renderSubjectStats(subjectStats, stats.totalStudySeconds);
  renderSubjectDonut(subjectStats);

  const finishedStudy = stats.completedSessions + stats.abandonedSessions + stats.cancelledSessions;
  if (finishedStudy === 0) {
    el.emptyState.hidden = false;
    el.overviewSection.hidden = true;
    el.chartsGrid.hidden = true;
    el.monthlySection.hidden = true;
    return;
  }
  el.emptyState.hidden = true;
  el.overviewSection.hidden = false;
  el.chartsGrid.hidden = false;

  const daily = buildDailySeries(sessions, DAILY_WINDOW_DAYS);
  const weekly = buildWeeklySeries(sessions, WEEKLY_WINDOW_WEEKS);
  const streaks = buildStreaks(sessions);
  const best = bestDayOf(daily);
  const goalSeconds = (doc.studyPlan.dailyGoalMinutes || 0) * 60;
  const metDays = goalDaysCount(daily, goalSeconds);
  const avgSeconds = averageSessionSeconds(stats);
  const rate = completionRatePercent(stats);
  const totalTime = stats.totalStudySeconds + stats.totalBreakSeconds;
  const breakPct = totalTime > 0 ? Math.round((stats.totalBreakSeconds / totalTime) * 100) : 0;

  el.statTotalTime.textContent = fmtHoursMinutes(stats.totalStudySeconds);
  el.statTotalTimeMeta.textContent = `${stats.totalSessions} ${t.sessions}`;

  el.statStreak.textContent = `${streaks.current} ${streaks.current === 1 ? t.day : t.days}`;
  el.statStreakMeta.textContent = `${t.longest}: ${streaks.longest} ${streaks.longest === 1 ? t.day : t.days}`;

  el.statCompletion.textContent = rate === null ? '—' : `${rate}%`;
  el.statCompletionMeta.textContent = `${stats.completedSessions} ${t.completed} · ${stats.abandonedSessions} ${t.abandoned}`;

  el.statAvgSession.textContent = avgSeconds > 0 ? fmtHoursMinutes(avgSeconds) : '—';
  el.statAvgSessionMeta.textContent = `${stats.totalSessions} ${t.sessions}`;

  el.statGoalDays.textContent = goalSeconds > 0 ? `${metDays}/${DAILY_WINDOW_DAYS}` : '—';
  el.statGoalDaysMeta.textContent = goalSeconds > 0 ? fmtHoursMinutes(goalSeconds) : t.noGoalSet;

  el.statBestDay.textContent =
    best && best.studySeconds > 0 ? fmtHoursMinutes(best.studySeconds) : '—';
  el.statBestDayMeta.textContent = best && best.studySeconds > 0 ? dayLabel(best.dayKey) : '—';

  el.statBreakTime.textContent = fmtHoursMinutes(stats.totalBreakSeconds);
  el.statBreakTimeMeta.textContent = `${breakPct}% ${t.ofTotalTime}`;

  el.dailyChart.innerHTML =
    renderBarChart(daily, { goalSeconds }) || `<div class="chart-empty">—</div>`;

  el.weeklyChart.innerHTML = renderLineChart(weekly) || `<div class="chart-empty">—</div>`;

  const segments = [
    {
      value: stats.completedSessions,
      className: 'chart-donut-segment--completed',
      label: t.completedLabel,
    },
    {
      value: stats.abandonedSessions,
      className: 'chart-donut-segment--abandoned',
      label: t.abandonedLabel,
    },
    {
      value: stats.cancelledSessions,
      className: 'chart-donut-segment--cancelled',
      label: t.cancelledLabel,
    },
  ];
  el.donutChart.innerHTML = renderDonutChart(segments) || `<div class="chart-empty">—</div>`;
  el.donutLegend.innerHTML = segments
    .map(
      (seg) =>
        `<span class="chart-legend__item"><span class="chart-legend__swatch ${seg.className}"></span>${seg.label} · ${seg.value}</span>`
    )
    .join('');

  renderDaypartChart(sessions);
  renderWeekdayChart(sessions);
  renderSessionLengthChart(sessions);
  renderPauseDonut(stats);
  renderMonthlyChart(sessions);
}

/* ------------------------------------------------------------
   Wiring
   ------------------------------------------------------------ */

el.langFaBtn.addEventListener('click', () => setLanguage('fa'));
el.langEnBtn.addEventListener('click', () => setLanguage('en'));
el.themeToggle.addEventListener('click', () => toggleTheme());

el.openFileBtn.addEventListener('click', () => pickAndOpen());
el.changeFileBtn.addEventListener('click', () => pickAndOpen());
el.refreshBtn.addEventListener('click', () => refresh());

el.importFileInput.addEventListener('change', async () => {
  const file = el.importFileInput.files && el.importFileInput.files[0];
  if (!file) return;
  try {
    importText(await file.text());
  } catch (err) {
    console.error(err);
    showToast(tr().readFailed, 'error');
  } finally {
    el.importFileInput.value = '';
  }
});

/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */

async function init() {
  applyLanguage();
  applyTheme();
  renderTranslations();

  const supported = FileStorage.isSupported();
  el.openFileBtn.hidden = !supported;
  if (!supported) showToast(tr().noFileApi, 'info');

  if (!supported) return; // wait for Import JSON

  const remembered = await FileStorage.loadHandle();
  if (!remembered) return; // connect panel stays visible

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

init();
