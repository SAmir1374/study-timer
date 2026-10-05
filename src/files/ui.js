/* =============================================================
   ui.js

   Presentation only. Reads from Application State and renders.
   Language changes here never modify stored data: FA shows Jalali +
   Persian labels + RTL, EN shows Gregorian + English labels + LTR.
   ============================================================= */

import {
  state,
  tr,
  todayKey,
  clamp,
  getExamProgress,
  getTodaySummary,
  getTodaySubjectBreakdown,
  getDaySessions,
  getDisplayedKind,
  mutateDocument,
  updateSettings,
  setSelectedMinutes,
} from './state.js';

import { WeeklyPlanStore } from './weeklyPlanStore.js';

import { TimerEngine, fmtHMS, fmtMS, fmtHoursMinutes, fmtClock } from './timer.js';

import { fromIso, sessionDayKey } from './dataLayer.js';
import { getTopicsForSubject, getAllTopics } from './topicsData.js';

const $ = (id) => document.getElementById(id);

/* ------------------------------------------------------------
   Schema v5: Day summary from sessions[]
   ------------------------------------------------------------ */

function computeDaySummary(day) {
  const sessions = Array.isArray(day?.sessions) ? day.sessions : [];

  const totals = {
    total: 0,
    english: 0,
    study: 0,
    practice: 0,
    test: 0,
    analysis: 0,
    review: 0,
  };

  const subjects = new Map();

  for (const s of sessions) {
    if (!s || typeof s !== 'object') continue;
    const m = Number(s.minutes) || 0;
    totals.total += m;
    if (s.subject === 'زبان تخصصی') totals.english += m;
    if (totals[s.type] !== undefined) totals[s.type] += m;
    if (s.subject) subjects.set(s.subject, (subjects.get(s.subject) || 0) + m);
  }

  const first = sessions.find((s) => s && s.subject && s.topic);
  const focus = first
    ? `${first.subject}: ${first.topic}`
    : sessions.length
      ? `${sessions.length} ${'جلسه'}`
      : 'بدون جلسه';

  return {
    ...totals,
    focus,
    sessionCount: sessions.length,
    subjects: [...subjects.entries()].sort((a, b) => b[1] - a[1]),
  };
}

/* ------------------------------------------------------------
   Helpers for day card (v5)
   ------------------------------------------------------------ */

/** نوع جلسه → برچسب فارسی/انگلیسی */
function typeLabel(type, language) {
  const map = {
    fa: {
      study: 'مطالعه',
      practice: 'تمرین',
      test: 'تست',
      analysis: 'تحلیل',
      review: 'مرور',
      break: 'استراحت',
    },
    en: {
      study: 'Study',
      practice: 'Practice',
      test: 'Test',
      analysis: 'Analysis',
      review: 'Review',
      break: 'Break',
    },
  };
  return (map[language] || map.fa)[type] || type;
}
/**
 * برای هر subject: مجموع دقیقه‌های برنامه‌ریزی‌شده vs انجام‌شده.
 * نتیجه: Map<subject, { planned, actual, pct }>
 */
function computeSubjectCompletion(day, daySessions = []) {
  const planned = new Map();
  for (const s of Array.isArray(day?.sessions) ? day.sessions : []) {
    if (!s?.subject) continue;
    planned.set(s.subject, (planned.get(s.subject) || 0) + (Number(s.minutes) || 0));
  }

  const actual = new Map();
  for (const s of daySessions) {
    if (!s || s.type === 'break') continue; // ← همه به‌جز break
    if (!s.subject) continue;
    const sec = Number(s.derived?.activeDurationSeconds) || 0;
    actual.set(s.subject, (actual.get(s.subject) || 0) + sec / 60);
  }

  const result = new Map();
  for (const [subj, plannedMin] of planned) {
    const actualMin = actual.get(subj) || 0;
    const pct = plannedMin > 0 ? Math.min(100, Math.round((actualMin / plannedMin) * 100)) : 0;
    result.set(subj, { planned: plannedMin, actual: actualMin, pct });
  }
  return result;
}

export const el = {
  body: document.body,

  // ↓ این ۵ خط جدید برای دکمه‌های فایل چک‌این
  checkinConnectFileBtn: $('checkinConnectFileBtn'),
  checkinOpenFileBtn: $('checkinOpenFileBtn'),
  checkinSaveNowBtn: $('checkinSaveNowBtn'),
  checkinExportBtn: $('checkinExportBtn'),
  checkinImportFileInput: $('checkinImportFileInput'),
  checkinBackupDirConnectBtn: $('checkinBackupDirConnectBtn'),
  checkinBackupStatusText: $('checkinBackupStatusText'),
  checkinSaveStatus: $('checkinSaveStatus'),
  checkinSaveStatusText: $('checkinSaveStatusText'),

  checkinModal: $('checkinModal'),
  checkinCloseBtn: $('checkinCloseBtn'),
  checkinSaveBtn: $('checkinSaveBtn'),
  checkinSkipBtn: $('checkinSkipBtn'),
  checkinBedTime: $('checkinBedTime'),
  checkinWakeTime: $('checkinWakeTime'),
  checkinSleepHours: $('checkinSleepHours'),
  checkinSleepQuality: $('checkinSleepQuality'),
  checkinSleepQualityValue: $('checkinSleepQualityValue'),
  checkinRoutineDone: $('checkinRoutineDone'),
  checkinRoutineStepsWrap: $('checkinRoutineStepsWrap'),
  checkinRoutineSteps: $('checkinRoutineSteps'),
  checkinActivity1: $('checkinActivity1'),
  checkinOperation1: $('checkinOperation1'),
  checkinYesterdayQuality: $('checkinYesterdayQuality'),
  checkinYesterdayQualityValue: $('checkinYesterdayQualityValue'),
  checkinExerciseDone: $('checkinExerciseDone'),
  checkinExerciseMinutesWrap: $('checkinExerciseMinutesWrap'),
  checkinExerciseMinutes: $('checkinExerciseMinutes'),

  weeklyPlanSaveStatus: $('weeklyPlanSaveStatus'),
  weeklyPlanSaveStatusText: $('weeklyPlanSaveStatusText'),
  weeklyPlanMeta: $('weeklyPlanMeta'),
  weeklyPlanWeekLabel: $('weeklyPlanWeekLabel'),
  weeklyPlanGoal: $('weeklyPlanGoal'),
  weeklyPlanDays: $('weeklyPlanDays'),
  weeklyPlanEmpty: $('weeklyPlanEmpty'),

  backupDirConnectBtn: $('backupDirConnectBtn'),
  weeklyBackupDirConnectBtn: document.getElementById('weeklyBackupDirConnectBtn'),
  weeklyBackupStatusText: document.getElementById('weeklyBackupStatusText'),

  weeklyPlanConnectFileBtn: $('weeklyPlanConnectFileBtn'),
  weeklyPlanOpenFileBtn: $('weeklyPlanOpenFileBtn'),
  weeklyPlanSaveNowBtn: $('weeklyPlanSaveNowBtn'),
  weeklyPlanExportBtn: $('weeklyPlanExportBtn'),
  weeklyPlanImportFileInput: $('weeklyPlanImportFileInput'),

  liveClock: $('liveClock'),
  liveDate: $('liveDate'),

  dailyStatusValue: $('dailyStatusValue'),
  weeklyStatusValue: $('weeklyStatusValue'),

  modeLabel: $('modeLabel'),
  statusLabel: $('statusLabel'),
  timeDisplay: $('timeDisplay'),
  timeCaption: $('timeCaption'),
  ringSubject: $('ringSubject'),
  elapsedValue: $('elapsedValue'),
  remainingValue: $('remainingValue'),

  progressLabel: $('progressLabel'),
  progressPercent: $('progressPercent'),
  sessionProgressFill: $('sessionProgressFill'),

  primaryBtn: $('primaryBtn'),
  primaryBtnLabel: $('primaryBtnLabel'),
  resetBtn: $('resetBtn'),
  finishBtn: $('finishBtn'),
  breakBtn: $('breakBtn'),

  kindGrid: $('kindGrid'),
  subjectGrid: $('subjectGrid'),

  presetGroup: document.querySelector('.preset-grid'),
  customDuration: $('customDuration'),
  customMinutes: $('customMinutes'),
  windowStart: $('windowStart'),
  windowEnd: $('windowEnd'),
  applyWindowBtn: $('applyWindowBtn'),

  todayDate: $('todayDate'),
  todayStudyTime: $('todayStudyTime'),
  todaySessions: $('todaySessions'),
  todayRemainingGoal: $('todayRemainingGoal'),
  dailyGoalValue: $('dailyGoalValue'),
  goalProgressFill: $('dailyGoalProgressFill'),
  subjectBreakdown: $('subjectBreakdown'),
  subjectBreakdownEmpty: $('subjectBreakdownEmpty'),

  timeline: $('timeline'),
  timelineEmpty: $('timelineEmpty'),
  historyList: $('history'),
  historyEmpty: $('historyEmpty'),

  examDaysLeft: $('examDaysLeft'),
  examWeekLabel: $('examWeekLabel'),
  examProgressFill: $('examProgressFill'),
  examDaysPassed: $('examDaysPassed'),
  examDaysLeftMini: $('examDaysLeftMini'),
  examEmptyNote: $('examEmptyNote'),

  saveStatus: $('saveStatus'),
  saveStatusText: $('saveStatusText'),

  settingsModal: $('settingsModal'),
  settingsCloseBtn: $('settingsCloseBtn'),
  saveSettingsBtn: $('saveSettingsBtn'),
  settingGoalHours: $('settingGoalHours'),
  settingDefaultMinutes: $('settingDefaultMinutes'),
  settingSound: $('settingSound'),
  settingClock24: $('settingClock24'),
  settingReducedMotion: $('settingReducedMotion'),
  settingAutoStart: $('settingAutoStart'),
  studyStartDate: $('studyStartDate'),
  examDate: $('examDate'),
  totalWeeks: $('totalWeeks'),

  newSubjectInput: $('newSubjectInput'),
  addSubjectBtn: $('addSubjectBtn'),
  subjectManageList: $('subjectManageList'),

  connectFileBtn: $('connectFileBtn'),
  openFileBtn: $('openFileBtn'),
  saveNowBtn: $('saveNowBtn'),
  exportBtn: $('exportBtn'),
  importFileInput: $('importFileInput'),
  clearDataBtn: $('clearDataBtn'),

  langFaBtn: $('langFaBtn'),
  langEnBtn: $('langEnBtn'),
  themeToggle: $('themeToggle'),
  fullscreenToggle: $('fullscreenToggle'),
  settingsToggle: $('settingsToggle'),

  toast: $('toast'),
  toastText: $('toastText'),
  daysStrip: $('daysStrip'),

  // Post-session modal: topic picker for study/practice, + full analysis for review
  analysisModal: $('analysisModal'),
  analysisModalTitleEl: $('analysisModalTitle'),
  analysisModalSubtitleEl: $('analysisModalSubtitle'),
  analysisCloseBtn: $('analysisCloseBtn'),
  analysisSubjectLabel: $('analysisSubjectLabel'),
  analysisTopic: $('analysisTopic'),
  analysisTopicOptions: $('analysisTopicOptions'),
  analysisMetricsSection: $('analysisMetricsSection'),
  analysisTestCount: $('analysisTestCount'),
  analysisCorrectPercent: $('analysisCorrectPercent'),
  analysisErrorCount: $('analysisErrorCount'),
  analysisSaveBtn: $('analysisSaveBtn'),
  analysisSkipBtn: $('analysisSkipBtn'),
};

/* ------------------------------------------------------------
   Render helpers
   ------------------------------------------------------------ */

/**
 * Detect exam plan dates from the weekly plan when Settings has none.
 * Returns { startDate, examDate, totalWeeks } or null.
 */
function getPlanDatesFromWeeklyPlan() {
  try {
    const weeks = WeeklyPlanStore.getWeeks();
    if (!weeks.length) return null;

    let minDate = null;
    let maxDate = null;

    for (const week of weeks) {
      const s = week?.startDate;
      const e = week?.endDate;
      if (s && (!minDate || s < minDate)) minDate = s;
      if (e && (!maxDate || e > maxDate)) maxDate = e;
    }

    if (!minDate || !maxDate) return null;

    // totalWeeks: difference in days / 7, rounded
    const [sy, sm, sd] = minDate.split('-').map(Number);
    const [ey, em, ed] = maxDate.split('-').map(Number);
    const days = Math.round((Date.UTC(ey, em - 1, ed) - Date.UTC(sy, sm - 1, sd)) / 86400000);
    const totalWeeks = Math.max(1, Math.ceil((days + 1) / 7));

    return { startDate: minDate, examDate: maxDate, totalWeeks };
  } catch (err) {
    console.warn('Could not detect plan dates from weekly plan:', err);
    return null;
  }
}

function dateLocale() {
  return state.doc.settings.language === 'fa' ? 'fa-IR-u-ca-persian' : 'en-US';
}

function escapeHtml(value) {
  return String(value ?? '').replace(
    /[&<>"']/g,
    (ch) =>
      ({
        '&': '&amp;',
        '<': '&lt;',
        '>': '&gt;',
        '"': '&quot;',
        "'": '&#39;',
      })[ch]
  );
}

/**
 * Returns the Saturday..Friday range containing dateKey.
 *
 * Input/output:
 * YYYY-MM-DD
 */
function saturdayWeekRange(dateKey) {
  const [year, month, day] = dateKey.split('-').map(Number);

  const date = new Date(Date.UTC(year, month - 1, day));

  const weekday = date.getUTCDay();

  // JS:
  // Sunday = 0
  // Monday = 1
  // ...
  // Saturday = 6
  //
  // Desired:
  // Saturday = 0
  // Sunday = 1
  // ...
  // Friday = 6
  const daysSinceSaturday = (weekday + 1) % 7;

  const start = new Date(date);

  start.setUTCDate(date.getUTCDate() - daysSinceSaturday);

  const end = new Date(start);

  end.setUTCDate(start.getUTCDate() + 6);

  const toKey = (value) => value.toISOString().slice(0, 10);

  return {
    start: toKey(start),
    end: toKey(end),
  };
}

/**
 * Returns actual study/review minutes recorded for a date.
 *
 * This is NOT the plan target.
 *
 * Planned target comes from:
 *     weekly plan -> week.targetMinutes
 *
 * Actual time comes from:
 *     state.doc.sessions
 */
function getActualMinutesForDate(dateKey) {
  const sessions = getDaySessions(dateKey);
  return sessions.reduce((total, session) => {
    if (!session || session.type === 'break') return total;
    const seconds = Number(session?.derived?.activeDurationSeconds) || 0;
    return total + seconds / 60;
  }, 0);
}

/**
 * Reads Schema v4:
 *
 * phases[]
 *   └── weeks[]
 *         └── days[]
 *
 * and creates a date-indexed map.
 *
 * Result:
 *
 * Map<
 *   "YYYY-MM-DD",
 *   {
 *     day,
 *     planWeek
 *   }
 * >
 */
function getWeeklyPlanDaysByDate() {
  const daysByDate = new Map();

  const planWeeks = WeeklyPlanStore.getWeeks();

  for (const planWeek of planWeeks) {
    const days = Array.isArray(planWeek?.days) ? planWeek.days : [];

    for (const day of days) {
      if (!day?.date) continue;

      /*
       * A valid plan should not contain duplicate dates.
       * If malformed data does, keep the first occurrence
       * instead of silently replacing it.
       */
      if (!daysByDate.has(day.date)) {
        daysByDate.set(day.date, {
          day,
          planWeek,
        });
      }
    }
  }

  return daysByDate;
}

/**
 * Converts the master plan's weeks into the visual
 * Saturday..Friday weeks used by this UI.
 *
 * Important:
 * The master plan itself may use another week boundary.
 */
function buildWeeklyPlanDisplayWeeks() {
  const daysByDate = getWeeklyPlanDaysByDate();

  const weeksByStart = new Map();

  for (const entry of daysByDate.values()) {
    const { day, planWeek } = entry;

    const range = saturdayWeekRange(day.date);

    if (!weeksByStart.has(range.start)) {
      weeksByStart.set(range.start, {
        start: range.start,
        end: range.end,
        entries: [],
      });
    }

    weeksByStart.get(range.start).entries.push({
      day,
      planWeek,
    });
  }

  return [...weeksByStart.values()].sort((a, b) => a.start.localeCompare(b.start));
}

/**
 * Returns unique master-plan weeks represented
 * inside a Saturday..Friday display week.
 */
function getUniqueSourceWeeks(entries) {
  const map = new Map();

  for (const { planWeek } of entries) {
    if (!planWeek?.id) continue;

    if (!map.has(planWeek.id)) {
      map.set(planWeek.id, planWeek);
    }
  }

  return [...map.values()];
}

/**
 * Sorts days:
 *
 * Saturday
 * Sunday
 * Monday
 * ...
 * Friday
 */
function sortPlanDays(entries) {
  const rankOf = (weekday) => (Number(weekday) + 1) % 7;

  return entries.slice().sort((a, b) => {
    const rankA = rankOf(a.day.weekday);
    const rankB = rankOf(b.day.weekday);

    if (rankA !== rankB) {
      return rankA - rankB;
    }

    return a.day.date.localeCompare(b.day.date);
  });
}

/**
 * Short human summary of a review session's
 * topic + analysis.
 */
function formatAnalysisSummary(rec) {
  if (rec.type !== 'analysis') return null;

  const t = tr();
  const a = rec.analysis || {};
  const parts = [];

  if (rec.topic) {
    parts.push(rec.topic);
  }

  if (a.testCount !== null && a.testCount !== undefined) {
    parts.push(`${t.analysisTestCount}: ${a.testCount}`);
  }

  if (a.correctPercent !== null && a.correctPercent !== undefined) {
    parts.push(`${t.analysisCorrectPercent}: ${a.correctPercent}%`);
  }

  if (a.analyzedErrorCount !== null && a.analyzedErrorCount !== undefined) {
    parts.push(`${t.analysisErrorCount}: ${a.analyzedErrorCount}`);
  }

  return parts.length ? parts.join(' · ') : null;
}

const MAX_VISIBLE_SESSIONS = 5;

function buildWeeklyPlanDayElement(day, actualMinutes, language, planWeek, daySessions = []) {
  const today = todayKey();
  const fa = language === 'fa';

  // وضعیت روز
  let status;
  if (day.date > today) status = 'future';
  else if (day.date === today) status = 'today';
  else if (actualMinutes > 0) status = 'partial';
  else status = 'missed';

  const sessions = Array.isArray(day?.sessions) ? day.sessions : [];
  const completion = computeSubjectCompletion(day, daySessions);

  // هدف روزانه
  const dailyTarget = sessions.reduce((sum, s) => sum + (Number(s.minutes) || 0), 0);
  const dayPercent =
    dailyTarget > 0 ? Math.min(100, Math.round((actualMinutes / dailyTarget) * 100)) : 0;

  // زبان تخصصی
  const englishMinutes = sessions
    .filter((s) => s.subject === 'زبان تخصصی')
    .reduce((sum, s) => sum + (Number(s.minutes) || 0), 0);

  // تعداد جلسات
  const sessionCount = daySessions.filter((s) => s.type !== 'break').length;

  // برچسب تاریخ
  const dateLabel = new Date(`${day.date}T00:00:00Z`).toLocaleDateString(
    fa ? 'fa-IR-u-ca-persian' : 'en-US',
    { weekday: 'short', month: 'short', day: 'numeric' }
  );

  const statusIcon = {
    future: '○',
    today: '●',
    partial: '◐',
    missed: '○',
  }[status];

  // ساخت ردیف جلسات
  const visibleSessions = sessions.slice(0, MAX_VISIBLE_SESSIONS);
  const hiddenCount = sessions.length - MAX_VISIBLE_SESSIONS;

  const sessionsHtml = visibleSessions
    .map((s) => {
      const comp = completion.get(s.subject);
      const pct = comp ? comp.pct : null;
      const pctClass = pct === 100 ? 'is-complete' : pct > 0 ? 'is-partial' : 'is-empty';

      return `
        <div class="day-session-row" title="${escapeHtml(s.subject)}: ${escapeHtml(s.topic)}">
          <span class="day-session-row__time">${escapeHtml(s.startTime)}</span>
          <span class="day-session-row__subject">${escapeHtml(s.subject)}</span>
          <span class="day-session-row__type kc-${escapeHtml(s.type)}">${typeLabel(s.type, language)}</span>
          ${
            pct !== null
              ? `<span class="day-session-row__pct ${pctClass}">${pct}%</span>`
              : `<span class="day-session-row__pct is-empty">—</span>`
          }
        </div>
      `;
    })
    .join('');

  const emptySessionsHtml = sessions.length
    ? ''
    : `<div class="day-session-row day-session-row--empty">${fa ? 'بدون جلسه' : 'No sessions'}</div>`;

  const moreHtml =
    hiddenCount > 0
      ? `<div class="day-session-row day-session-row--more">+${hiddenCount} ${fa ? 'جلسه دیگر' : 'more'}</div>`
      : '';

  const dayElement = document.createElement('div');
  dayElement.className = `weekly-plan-day is-${status}`;
  dayElement.dataset.date = day.date;
  dayElement.tabIndex = 0;
  dayElement.setAttribute('role', 'button');
  dayElement.setAttribute('aria-label', `${dateLabel} — ${fa ? 'مشاهده جزئیات' : 'View details'}`);

  dayElement.innerHTML = `
    <div class="weekly-plan-day__header">
      <div class="weekly-plan-day__identity">
        <div class="weekly-plan-day__title">
          <span class="weekly-plan-day__status-icon">${statusIcon}</span>
          ${escapeHtml(dateLabel)}
        </div>
        <div class="weekly-plan-day__date">${escapeHtml(day.date)}</div>
      </div>
      <div class="weekly-plan-day__target">
        <strong>${dailyTarget > 0 ? fmtHoursMinutes(dailyTarget * 60) : '—'}</strong>
        <span>${fa ? 'هدف روز' : 'Daily goal'}</span>
      </div>
    </div>

    <div class="weekly-plan-day__progress">
      <div class="weekly-plan-day__progress-bar">
        <span style="width: ${dayPercent}%"></span>
      </div>
      <span class="weekly-plan-day__progress-label">
        ${dayPercent}% ${fa ? 'از هدف' : 'of goal'}
        · ${fmtHoursMinutes(Math.round(actualMinutes * 60))}
      </span>
    </div>

    <div class="weekly-plan-day__sessions-list">
      ${sessionsHtml}
      ${moreHtml}
      ${emptySessionsHtml}
    </div>

    <div class="weekly-plan-day__footer">
      <span class="weekly-plan-day__english">🇬🇧 ${englishMinutes}${fa ? 'د' : 'm'}</span>
      <span class="weekly-plan-day__sessions">${sessionCount} ${fa ? 'جلسه ثبت‌شده' : 'recorded'}</span>
    </div>
  `;

  return dayElement;
}

/* ------------------------------------------------------------
   Render
   ------------------------------------------------------------ */

export const Render = {
  _lastText: new WeakMap(),

  setText(node, value) {
    if (!node) return;

    if (this._lastText.get(node) === value) {
      return;
    }

    this._lastText.set(node, value);
    node.textContent = value;
  },

  resetCache() {
    this._lastText = new WeakMap();
  },

  clock() {
    const now = Date.now();

    this.setText(el.liveClock, fmtClock(now));

    this.setText(
      el.liveDate,
      new Date(now).toLocaleDateString(dateLocale(), {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
      })
    );

    this.setText(
      el.todayDate,
      new Date(now).toLocaleDateString(dateLocale(), {
        month: 'short',
        day: 'numeric',
      })
    );
  },

  statusText() {
    const s = state.session;
    const t = tr();
    if (s.state === 'running' || s.state === 'paused') {
      if (s.type === 'break') return s.state === 'paused' ? t.paused : t.onBreak;
      if (s.type === 'analysis') return s.state === 'paused' ? t.paused : t.analyzing;
      if (s.type === 'review') return s.state === 'paused' ? t.paused : t.reviewing;
      return s.state === 'paused' ? t.paused : t.focusing;
    }
    if (s.state === 'complete') {
      if (s.type === 'break') return t.breakComplete;
      if (s.type === 'analysis') return t.analysisComplete;
      if (s.type === 'review') return t.reviewComplete;
      return t.sessionComplete;
    }
    return t.readyToFocus;
  },

  timer() {
    const s = state.session;
    const t = tr();

    const remaining = TimerEngine.remainingMs();

    const elapsed = TimerEngine.elapsedMs();

    const fraction = s.durationMs > 0 ? Math.min(1, elapsed / s.durationMs) : 0;

    el.body.setAttribute('data-state', s.state);

    el.body.setAttribute('data-type', s.type);

    const modeText =
      s.type === 'break'
        ? t.break
        : s.type === 'analysis'
          ? t.analysisSessionLabel
          : s.type === 'review'
            ? t.reviewSessionLabel
            : t.focusSession;

    this.setText(el.modeLabel, modeText);

    this.setText(el.statusLabel, this.statusText());

    this.setText(el.timeDisplay, fmtHMS(remaining));

    this.setText(el.timeCaption, s.state === 'complete' ? t.done : t.timeRemaining);

    this.setText(el.elapsedValue, fmtMS(elapsed));

    this.setText(el.remainingValue, fmtMS(remaining));

    if (el.ringSubject) {
      const parts = [];
      if (s.type !== 'break') {
        if (s.subject) parts.push(s.subject);
        const kindLabel =
          s.type === 'practice'
            ? t.kindPractice
            : s.type === 'test'
              ? t.kindTest
              : s.type === 'analysis'
                ? t.kindAnalysis
                : s.type === 'review'
                  ? t.kindReview
                  : null;
        if (kindLabel) parts.push(kindLabel);
      }
      el.ringSubject.hidden = parts.length === 0;
      this.setText(el.ringSubject, parts.join(' · '));
    }

    const pct = Math.round(fraction * 100);

    const progressText =
      s.type === 'break'
        ? t.break
        : s.type === 'analysis'
          ? t.kindAnalysis
          : s.type === 'review'
            ? t.kindReview
            : s.type === 'test'
              ? t.kindTest
              : s.type === 'practice'
                ? t.kindPractice
                : t.studySession;

    this.setText(el.progressLabel, progressText);

    this.setText(el.progressPercent, pct + '%');

    el.sessionProgressFill.style.width = pct + '%';

    this.setText(
      el.primaryBtnLabel,
      s.state === 'running' ? t.pause : s.state === 'paused' ? t.resume : t.start
    );

    el.finishBtn.disabled = s.state === 'idle' || s.state === 'complete';

    el.resetBtn.disabled = s.state === 'complete';

    el.breakBtn.hidden = s.state === 'running' || s.state === 'paused';

    this.setText(el.breakBtn, s.type === 'break' ? t.backToStudy : t.startBreak);
  },

  stats() {
    const t = tr();
    const s = state.session;
    const day = getTodaySummary();

    const live =
      s.record && s.type === 'study' && (s.state === 'running' || s.state === 'paused')
        ? Math.round(TimerEngine.elapsedMs() / 1000)
        : 0;

    const totalSeconds = day.studySeconds + live;

    this.setText(el.todayStudyTime, fmtHoursMinutes(totalSeconds));

    this.setText(el.todaySessions, String(day.sessionCount));

    const goalMinutes = this.getEffectiveDailyGoalMinutes();

    const goalSeconds = goalMinutes * 60;

    this.setText(el.dailyGoalValue, fmtHoursMinutes(goalSeconds));

    const remainingGoal = Math.max(0, goalSeconds - totalSeconds);

    this.setText(
      el.todayRemainingGoal,
      remainingGoal === 0 ? t.goalMet : fmtHoursMinutes(remainingGoal)
    );

    const goalPct = goalSeconds > 0 ? Math.round(Math.min(1, totalSeconds / goalSeconds) * 100) : 0;

    el.goalProgressFill.style.width = goalPct + '%';
  },

  /**
   * Today's goal in minutes.
   *
   * IMPORTANT:
   * Schema v4 has weekly targetMinutes,
   * not a daily target.
   *
   * Therefore we intentionally keep the
   * existing application-level daily goal.
   */
  /**
   * هدف امروز بر اساس برنامه‌ی هفتگی.
   * اگر برنامه‌ای برای امروز نبود یا خالی بود، به dailyGoalMinutes (پیش‌فرض ۴ ساعت) برمی‌گردد.
   */
  getEffectiveDailyGoalMinutes() {
    try {
      const today = todayKey();
      const weeks = WeeklyPlanStore.getWeeks();

      for (const week of weeks) {
        const days = Array.isArray(week.days) ? week.days : [];
        const todayDay = days.find((d) => d && d.date === today);
        if (!todayDay) continue;

        const sessions = Array.isArray(todayDay.sessions) ? todayDay.sessions : [];
        if (!sessions.length) break;

        const totalMinutes = sessions.reduce((sum, s) => sum + (Number(s.minutes) || 0), 0);

        if (totalMinutes > 0) return totalMinutes;
      }
    } catch (err) {
      console.warn('Could not read weekly plan for today:', err);
    }

    // Fallback به تنظیمات
    return state.doc.studyPlan.dailyGoalMinutes || 240;
  },

  /**
   * Today's per-(subject, kind) totals.
   *
   * The same subject can appear twice:
   * regular study + practice tests.
   */
  todaySubjects() {
    if (!el.subjectBreakdown) return;

    const t = tr();

    const items = getTodaySubjectBreakdown();

    el.subjectBreakdown
      .querySelectorAll('.subject-breakdown-item')
      .forEach((node) => node.remove());

    if (!items.length) {
      el.subjectBreakdownEmpty.hidden = false;

      return;
    }

    el.subjectBreakdownEmpty.hidden = true;

    items.forEach((item) => {
      const row = document.createElement('div');

      row.className =
        'subject-breakdown-item' +
        (item.kind === 'practice' ? ' subject-breakdown-item--practice' : '') +
        (item.kind === 'review' ? ' subject-breakdown-item--review' : '');

      const label = document.createElement('span');

      label.className = 'subject-breakdown-item__label';

      const suffix =
        item.kind === 'practice'
          ? t.practiceShort
          : item.kind === 'test'
            ? t.testShort
            : item.kind === 'analysis'
              ? t.analysisShort
              : item.kind === 'review'
                ? t.reviewShort
                : null;

      label.textContent = suffix ? `${item.subject} · ${suffix}` : item.subject;

      const value = document.createElement('span');

      value.className = 'subject-breakdown-item__value';

      value.textContent = fmtHoursMinutes(item.studySeconds);

      row.appendChild(label);
      row.appendChild(value);

      row.className =
        'subject-breakdown-item' +
        (item.kind === 'practice' ? ' subject-breakdown-item--practice' : '') +
        (item.kind === 'test' ? ' subject-breakdown-item--test' : '') +
        (item.kind === 'analysis' ? ' subject-breakdown-item--analysis' : '') +
        (item.kind === 'review' ? ' subject-breakdown-item--review' : '');

      el.subjectBreakdown.appendChild(row);
    });
  },

  timeline() {
    const t = tr();

    const items = getDaySessions(todayKey());

    el.timeline.querySelectorAll('.timeline-item').forEach((node) => node.remove());

    if (!items.length) {
      el.timelineEmpty.hidden = false;
      return;
    }

    el.timelineEmpty.hidden = true;

    const maxDur = Math.max(
      ...items.map((rec) => Number(rec?.derived?.activeDurationSeconds) || 0),
      1
    );

    items.forEach((rec) => {
      const row = document.createElement('div');
      row.className = 'timeline-item';

      if (rec.type !== 'break') {
        const parts = [];

        if (rec.subject) parts.push(rec.subject);

        const kindShort =
          rec.type === 'practice'
            ? t.practiceShort
            : rec.type === 'test'
              ? t.testShort
              : rec.type === 'analysis'
                ? t.analysisShort
                : rec.type === 'review'
                  ? t.reviewShort
                  : null;

        if (kindShort) parts.push(kindShort);

        if (rec.topic) parts.push(rec.topic);

        if (rec.type === 'analysis') {
          const summary = formatAnalysisSummary(rec);
          if (summary) parts.push(summary);
        }

        row.title = parts.join(' · ');
      } else {
        row.title = t.break;
      }

      const bar = document.createElement('span');

      bar.className =
        'timeline-item__bar' +
        (rec.type === 'break' ? ' timeline-item__bar--break' : '') +
        (rec.type === 'practice' ? ' timeline-item__bar--practice' : '') +
        (rec.type === 'test' ? ' timeline-item__bar--test' : '') +
        (rec.type === 'analysis' ? ' timeline-item__bar--analysis' : '') +
        (rec.type === 'review' ? ' timeline-item__bar--review' : '');

      const durationSeconds = Number(rec?.derived?.activeDurationSeconds) || 0;

      bar.style.flexGrow = String(Math.max(0.15, durationSeconds / maxDur));
      bar.style.flexBasis = '0';

      const label = document.createElement('span');
      label.className = 'timeline-item__label';

      label.textContent = `${fmtClock(fromIso(rec.actual.startedAt))}–${fmtClock(
        fromIso(rec.actual.endedAt)
      )}`;

      row.appendChild(bar);
      row.appendChild(label);

      el.timeline.appendChild(row);
    });
  },

  history() {
    const t = tr();

    const items = getDaySessions(todayKey()).reverse();

    el.historyList.querySelectorAll('.history-item').forEach((node) => node.remove());

    if (!items.length) {
      el.historyEmpty.hidden = false;

      return;
    }

    el.historyEmpty.hidden = true;

    items.forEach((rec) => {
      const row = document.createElement('div');

      row.className = 'history-item';

      const left = document.createElement('span');

      left.className = 'history-item__time';

      left.textContent = `${fmtClock(fromIso(rec.actual.startedAt))} – ${fmtClock(
        fromIso(rec.actual.endedAt)
      )}`;

      if (rec.type === 'break') {
        const tag = document.createElement('span');

        tag.className = 'history-item__type';

        tag.textContent = t.break;

        left.appendChild(tag);
      } else {
        if (rec.subject) {
          const tagClass =
            rec.type === 'practice'
              ? 'history-item__practice'
              : rec.type === 'test'
                ? 'history-item__test'
                : rec.type === 'analysis'
                  ? 'history-item__analysis-tag'
                  : rec.type === 'review'
                    ? 'history-item__review'
                    : null;

          if (tagClass) {
            const tag = document.createElement('span');
            tag.className = tagClass;
            tag.textContent =
              rec.type === 'practice'
                ? t.practiceShort
                : rec.type === 'test'
                  ? t.testShort
                  : rec.type === 'analysis'
                    ? t.analysisShort
                    : t.reviewShort;
            left.appendChild(tag);
          }

          const tag = document.createElement('span');
          tag.className = 'history-item__subject';
          tag.textContent = rec.subject;
          left.appendChild(tag);
        }

        if (rec.type === 'study' && rec.isPractice) {
          const tag = document.createElement('span');

          tag.className = 'history-item__practice';

          tag.textContent = t.practiceShort;

          left.appendChild(tag);
        }

        if (rec.type === 'review') {
          const tag = document.createElement('span');

          tag.className = 'history-item__review';

          tag.textContent = t.reviewShort;

          left.appendChild(tag);
        }
      }

      const right = document.createElement('span');

      right.className = 'history-item__duration';

      right.textContent = fmtHoursMinutes(Number(rec?.derived?.activeDurationSeconds) || 0);

      row.appendChild(left);
      row.appendChild(right);

      if (rec.type === 'review') {
        const summary = formatAnalysisSummary(rec);

        const analysisRow = document.createElement('div');

        analysisRow.className = 'history-item__analysis';

        analysisRow.textContent = summary || t.noSubjectDataToday;

        row.appendChild(analysisRow);
      } else if (rec.type === 'study' && rec.topic) {
        const topicRow = document.createElement('div');

        topicRow.className = 'history-item__analysis';

        topicRow.textContent = rec.topic;

        row.appendChild(topicRow);
      }

      if (rec.type === 'analysis') {
        const summary = formatAnalysisSummary(rec);
        const analysisRow = document.createElement('div');
        analysisRow.className = 'history-item__analysis';
        analysisRow.textContent = summary || t.noSubjectDataToday;
        row.appendChild(analysisRow);
      } else if (rec.type !== 'break' && rec.topic) {
        const topicRow = document.createElement('div');
        topicRow.className = 'history-item__analysis';
        topicRow.textContent = rec.topic;
        row.appendChild(topicRow);
      }

      el.historyList.appendChild(row);
    });
  },

  presets() {
    const minutes = Math.round(state.session.durationMs / 60000);

    const presets = [25, 50, 90, 120];

    el.presetGroup.querySelectorAll('.preset-btn').forEach((btn) => {
      const isCustomBtn = btn.id === 'customPresetBtn';

      const active = isCustomBtn
        ? !presets.includes(minutes)
        : Number(btn.dataset.minutes) === minutes;

      btn.classList.toggle('is-active', active);
    });

    if (!presets.includes(minutes)) {
      el.customDuration.hidden = false;

      el.customMinutes.value = minutes;
    } else {
      el.customDuration.hidden = true;
    }
  },

  /**
   * Rebuilds the subject chip picker
   * from doc.subjects.
   */
  subjects() {
    if (!el.subjectGrid) return;

    const t = tr();
    const current = state.session.subject;

    el.subjectGrid.innerHTML = '';

    const makeChip = (label, value) => {
      const btn = document.createElement('button');

      btn.type = 'button';

      btn.className = 'subject-chip' + (current === value ? ' is-active' : '');

      btn.textContent = label;

      btn.dataset.subject = value || '';

      return btn;
    };

    el.subjectGrid.appendChild(makeChip(t.noSubject, null));

    state.doc.subjects.forEach((subject) => {
      el.subjectGrid.appendChild(makeChip(subject.name, subject.name));
    });
  },

  /**
   * Study / Practice-test /
   * Test-analysis switch.
   */
  kind() {
    if (!el.kindGrid) return;

    const kind = getDisplayedKind();

    el.kindGrid.querySelectorAll('.kind-btn').forEach((btn) => {
      btn.classList.toggle('is-active', btn.dataset.kind === kind);
    });
  },

  /**
   * Renders the complete Schema v4
   * phased master study plan.
   *
   * Source:
   *
   * WeeklyPlanStore.getDoc()
   *       ↓
   * WeeklyPlanStore.getWeeks()
   *       ↓
   * weeks[].days[]
   *
   * Display:
   *
   * Saturday → Friday
   */
  weeklyPlan() {
    const language = state.language || 'fa';

    const container = el.weeklyPlanDays;

    const meta = el.weeklyPlanMeta;

    const weekLabel = el.weeklyPlanWeekLabel;

    const goal = el.weeklyPlanGoal;

    const empty = el.weeklyPlanEmpty;

    if (!container) return;

    container.innerHTML = '';

    /*
     * ----------------------------------------------------------
     * 1. No plan data
     * ----------------------------------------------------------
     */

    if (!WeeklyPlanStore.hasData()) {
      if (meta) {
        meta.hidden = true;
      }

      if (empty) {
        empty.hidden = false;

        empty.textContent =
          language === 'fa'
            ? 'برای مشاهده برنامه هفتگی، فایل برنامه هفتگی را از تنظیمات متصل کنید.'
            : 'Connect a weekly plan file in Settings to see your weekly plan.';
      }

      return;
    }

    /*
     * ----------------------------------------------------------
     * 2. File exists in memory but may need reconnect
     * ----------------------------------------------------------
     */

    if (!WeeklyPlanStore.isConnected() && meta) {
      meta.dataset.needsReconnect =
        WeeklyPlanStore.status.state === 'permission' ? 'true' : 'false';
    } else if (meta) {
      delete meta.dataset.needsReconnect;
    }

    /*
     * ----------------------------------------------------------
     * 3. Build display weeks
     * ----------------------------------------------------------
     */

    const today = todayKey();

    const weeks = buildWeeklyPlanDisplayWeeks();

    if (!weeks.length) {
      if (meta) {
        meta.hidden = true;
      }

      if (empty) {
        empty.hidden = false;

        empty.textContent =
          language === 'fa'
            ? 'در فایل برنامه، روزی برای نمایش وجود ندارد.'
            : 'No planned days were found in the weekly plan.';
      }

      return;
    }

    if (empty) {
      empty.hidden = true;
    }

    /*
     * ----------------------------------------------------------
     * 4. Find current display week
     * ----------------------------------------------------------
     */

    let currentWeek = null;

    /*
     * ----------------------------------------------------------
     * 5. Render all weeks
     * ----------------------------------------------------------
     */

    weeks.forEach((week, index) => {
      const weekState = week.end < today ? 'past' : week.start > today ? 'upcoming' : 'current';

      if (weekState === 'current') {
        currentWeek = week;
      }

      /*
       * Saturday → Friday
       */
      const entries = sortPlanDays(week.entries);

      /*
       * Master-plan source weeks.
       */
      const sourceWeeks = getUniqueSourceWeeks(entries);

      /*
       * Actual study/review
       * recorded in Study Timer.
       */
      const actualMinutes = entries.reduce(
        (sum, { day }) => sum + getActualMinutesForDate(day.date),
        0
      );

      /*
       * IMPORTANT:
       *
       * If this visual week contains
       * exactly one source plan week,
       * targetMinutes can be compared
       * directly.
       *
       * If it contains multiple source
       * weeks, do not sum them.
       */
      const targetMinutes =
        sourceWeeks.length === 1 ? Number(sourceWeeks[0]?.targetMinutes) || 0 : null;

      const weekPercent =
        targetMinutes > 0 ? Math.min(100, Math.round((actualMinutes / targetMinutes) * 100)) : null;

      /*
       * ------------------------------------------------------
       * Section
       * ------------------------------------------------------
       */

      const section = document.createElement('div');

      section.className = 'weekly-plan-week';

      section.dataset.weekState = weekState;

      /*
       * ------------------------------------------------------
       * Badge
       * ------------------------------------------------------
       */

      const badgeText = {
        past: language === 'fa' ? 'تمام شده' : 'Finished',

        current: language === 'fa' ? 'هفته جاری' : 'Current week',

        upcoming: language === 'fa' ? 'پیش‌رو' : 'Upcoming',
      }[weekState];

      /*
       * ------------------------------------------------------
       * Source week label
       * ------------------------------------------------------
       */

      let sourceWeekText = '';

      if (sourceWeeks.length === 1) {
        sourceWeekText = sourceWeeks[0]?.id ? escapeHtml(sourceWeeks[0].id) : '';
      } else if (sourceWeeks.length > 1) {
        sourceWeekText = sourceWeeks
          .map((source) => (source?.id ? escapeHtml(source.id) : ''))
          .filter(Boolean)
          .join(' · ');
      }

      /*
       * ------------------------------------------------------
       * Target label
       * ------------------------------------------------------
       */

      let targetText = '';

      if (sourceWeeks.length === 1) {
        const target = Number(sourceWeeks[0]?.targetMinutes) || 0;

        if (target > 0) {
          targetText =
            language === 'fa' ? `هدف برنامه: ${target} دقیقه` : `Plan target: ${target} min`;
        }
      } else if (sourceWeeks.length > 1) {
        const targets = sourceWeeks
          .map((source) => {
            const target = Number(source?.targetMinutes) || 0;

            if (!target) {
              return null;
            }

            return source?.id ? `${escapeHtml(source.id)}: ${target}` : String(target);
          })
          .filter(Boolean);

        if (targets.length) {
          targetText =
            language === 'fa'
              ? `اهداف برنامه: ${targets.join(' · ')} دقیقه`
              : `Plan targets: ${targets.join(' · ')} min`;
        }
      }

      /*
       * ------------------------------------------------------
       * Progress
       * ------------------------------------------------------
       */

      let progressText = '';

      if (weekState !== 'upcoming' && targetMinutes) {
        progressText = language === 'fa' ? `${weekPercent}٪ از هدف` : `${weekPercent}% of target`;
      }

      /*
       * ------------------------------------------------------
       * Header
       * ------------------------------------------------------
       */

      const header = document.createElement('div');

      header.className = 'weekly-plan-week__header';

      header.innerHTML = `
  <div class="weekly-plan-week__identity">
    <span class="weekly-plan-week__name">
      ${language === 'fa' ? 'هفته' : 'Week'} ${index + 1}
      ${sourceWeekText ? ` • ${sourceWeekText}` : ''}
    </span>

    <span class="weekly-plan-week__range">
      ${escapeHtml(week.start)} ${language === 'fa' ? 'تا' : '–'} ${escapeHtml(week.end)}
    </span>

    ${targetText ? `<span class="weekly-plan-week__target">${targetText}</span>` : ''}
  </div>

  <div class="weekly-plan-week__summary">
    <span class="weekly-plan-week__goal">
      ${
        language === 'fa'
          ? `مطالعه واقعی: ${Math.round(actualMinutes)} دقیقه`
          : `Actual: ${Math.round(actualMinutes)} min`
      }
    </span>

    ${progressText ? `<span class="weekly-plan-week__progress">${progressText}</span>` : ''}

    <span class="weekly-plan-week__badge">${badgeText}</span>
  </div>

  <div class="weekly-plan-week__progress-bar">
    <div class="weekly-plan-week__progress-bar-fill" style="width: ${weekPercent || 0}%"></div>
  </div>
`;

      section.appendChild(header);
      /*
       * ------------------------------------------------------
       * Days
       * ------------------------------------------------------
       */

      const grid = document.createElement('div');

      grid.className = 'weekly-plan-week__days';

      entries.forEach(({ day, planWeek }) => {
        const daySessions = getDaySessions(day.date);

        const dayActualMinutes = daySessions.reduce((sum, s) => {
          if (!s || s.type === 'break') return sum;
          return sum + (Number(s.derived?.activeDurationSeconds) || 0) / 60;
        }, 0);

        grid.appendChild(
          buildWeeklyPlanDayElement(day, dayActualMinutes, language, planWeek, daySessions)
        );
      });

      section.appendChild(grid);

      container.appendChild(section);
    });

    /*
     * ----------------------------------------------------------
     * 6. Top metadata
     * ----------------------------------------------------------
     */

    if (meta) {
      meta.hidden = false;
    }

    if (currentWeek) {
      const sourceWeeks = getUniqueSourceWeeks(currentWeek.entries);

      const currentActualMinutes = currentWeek.entries.reduce(
        (sum, { day }) => sum + getActualMinutesForDate(day.date),
        0
      );

      /*
       * Current source week label.
       */

      const sourceLabel =
        sourceWeeks.length === 1
          ? sourceWeeks[0]?.id || ''
          : sourceWeeks
              .map((week) => week?.id)
              .filter(Boolean)
              .join(' · ');

      if (weekLabel) {
        weekLabel.textContent =
          language === 'fa'
            ? `${sourceLabel || 'برنامه هفتگی'} • ${currentWeek.start} تا ${currentWeek.end}`
            : `${sourceLabel || 'Weekly Plan'} • ${currentWeek.start} – ${currentWeek.end}`;
      }

      /*
       * Current target.
       *
       * Again, only show a direct target
       * when exactly one master-plan week
       * is represented.
       */

      if (goal) {
        if (sourceWeeks.length === 1) {
          const currentTarget = Number(sourceWeeks[0]?.targetMinutes) || 0;

          if (currentTarget > 0) {
            const currentPercent = Math.min(
              100,
              Math.round((currentActualMinutes / currentTarget) * 100)
            );

            goal.textContent =
              language === 'fa'
                ? `هدف ${currentTarget} دقیقه • ${Math.round(
                    currentActualMinutes
                  )} دقیقه انجام شده • ${currentPercent}٪`
                : `${currentTarget} min goal • ${Math.round(
                    currentActualMinutes
                  )} min actual • ${currentPercent}%`;
          } else {
            goal.textContent =
              language === 'fa'
                ? `${Math.round(currentActualMinutes)} دقیقه مطالعه واقعی`
                : `${Math.round(currentActualMinutes)} min actual study`;
          }
        } else if (sourceWeeks.length > 1) {
          goal.textContent =
            language === 'fa'
              ? `${sourceWeeks.length} هفته برنامه‌ای • ${Math.round(
                  currentActualMinutes
                )} دقیقه مطالعه واقعی`
              : `${sourceWeeks.length} plan weeks • ${Math.round(currentActualMinutes)} min actual study`;
        } else {
          goal.textContent =
            language === 'fa'
              ? `${Math.round(currentActualMinutes)} دقیقه مطالعه واقعی`
              : `${Math.round(currentActualMinutes)} min actual study`;
        }
      }
    } else {
      /*
       * No current week.
       *
       * This normally means all plan dates are
       * before or after today.
       */

      if (weekLabel) {
        weekLabel.textContent =
          language === 'fa' ? `${weeks.length} هفته برنامه` : `${weeks.length} planned weeks`;
      }

      if (goal) {
        goal.textContent =
          language === 'fa' ? 'هفته جاری در بازه برنامه نیست' : 'Current week is outside the plan';
      }
    }
  },

  exam() {
    let progress = getExamProgress();

    // ✅ اگر Settings خالی بود، از برنامه‌ی هفتگی تشخیص بده
    if (!progress) {
      const detected = getPlanDatesFromWeeklyPlan();
      if (detected) {
        // محاسبه‌ی progress از روی تاریخ‌های کشف‌شده
        const today = todayKey();
        const [sy, sm, sd] = detected.startDate.split('-').map(Number);
        const [ey, em, ed] = detected.examDate.split('-').map(Number);
        const startMs = Date.UTC(sy, sm - 1, sd);
        const endMs = Date.UTC(ey, em - 1, ed);
        const [ty, tm, td] = today.split('-').map(Number);
        const todayMs = Date.UTC(ty, tm - 1, td);

        const totalDays = Math.max(1, Math.round((endMs - startMs) / 86400000) + 1);
        const daysPassed = clamp(Math.round((todayMs - startMs) / 86400000) + 1, 0, totalDays);
        const daysLeft = Math.max(0, totalDays - daysPassed);
        const currentWeek = Math.min(
          detected.totalWeeks,
          Math.max(1, Math.ceil((daysPassed + 1) / 7))
        );
        const progressPercent = Math.round((daysPassed / totalDays) * 100);

        progress = {
          totalDays,
          daysPassed,
          daysLeft,
          currentWeek,
          totalWeeks: detected.totalWeeks,
          progressPercent,
        };
      }
    }

    if (!progress) {
      el.examEmptyNote.hidden = false;

      this.setText(el.examDaysLeft, '—');

      this.setText(el.examDaysPassed, '—');

      this.setText(el.examWeekLabel, '—');

      this.setText(el.examDaysLeftMini, '—');

      el.examProgressFill.style.width = '0%';

      return;
    }

    el.examEmptyNote.hidden = true;

    const t = tr();

    this.setText(el.examDaysLeft, String(progress.daysLeft));

    this.setText(el.examDaysPassed, `${progress.daysPassed} ${t.daysPassed}`);

    this.setText(el.examWeekLabel, `${t.week} ${progress.currentWeek} / ${progress.totalWeeks}`);

    el.examProgressFill.style.width = `${progress.progressPercent}%`;

    this.setText(el.examDaysLeftMini, `${progress.daysLeft} ${t.daysLeft}`);

    if (el.dailyStatusValue) {
      const today = getTodaySummary();

      this.setText(el.dailyStatusValue, `${fmtHoursMinutes(today.studySeconds)}`);
    }

    if (el.weeklyStatusValue) {
      this.setText(el.weeklyStatusValue, `Week ${progress.currentWeek}`);
    }
  },

  saveStatus() {
    if (!el.saveStatus) return;

    const t = tr();
    const f = state.file;

    const keys = {
      unsupported: 'saveUnsupported',
      disconnected: 'saveNotConnected',
      permission: 'savePermission',
      saved: 'saveSaved',
      saving: 'saveSaving',
      unsaved: 'saveUnsaved',
      error: 'saveError',
    };

    let text = t[keys[f.status]] || t.saveNotConnected;

    if (f.name && ['saved', 'saving', 'unsaved'].includes(f.status)) {
      text += ` · ${f.name}`;
    }

    el.saveStatus.dataset.status = f.status;

    el.saveStatus.title = f.error || '';

    this.setText(el.saveStatusText, text);
  },

  weeklyPlanStatus() {
    if (!el.weeklyPlanSaveStatus) {
      return;
    }

    const t = tr();

    const f = WeeklyPlanStore.status;

    const keys = {
      unsupported: 'saveUnsupported',
      disconnected: 'saveNotConnected',
      permission: 'savePermission',
      saved: 'saveSaved',
      saving: 'saveSaving',
      unsaved: 'saveUnsaved',
      error: 'saveError',
    };

    let text = t[keys[f.state]] || t.saveNotConnected;

    if (f.name && ['saved', 'saving', 'unsaved'].includes(f.state)) {
      text += ` · ${f.name}`;
    }

    el.weeklyPlanSaveStatus.dataset.status = f.state;

    el.weeklyPlanSaveStatus.title = f.error || '';

    this.setText(el.weeklyPlanSaveStatusText, text);
  },

  all() {
    this.clock();
    this.timer();
    this.stats();
    this.todaySubjects();
    this.timeline();
    this.history();
    this.presets();
    this.kind();
    this.subjects();
    this.exam();
    this.saveStatus();
    this.daysStrip();
    this.weeklyPlan();
    this.weeklyPlanStatus();
  },
};

/* ------------------------------------------------------------
   Days strip — full plan calendar (Persian dates, compact)
   ------------------------------------------------------------ */

/**
 * Converts a YYYY-MM-DD key to Persian date parts.
 * Uses Intl with Persian calendar.
 */
function getPersianDateParts(dateKey) {
  const [y, m, d] = dateKey.split('-').map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  try {
    const fmt = new Intl.DateTimeFormat('fa-IR-u-ca-persian', {
      year: 'numeric',
      month: 'long',
      day: 'numeric',
      timeZone: 'UTC',
    });
    const parts = fmt.formatToParts(date);
    const get = (type) => parts.find((p) => p.type === type)?.value || '';
    return {
      year: get('year'),
      month: get('month'),
      day: get('day'),
      full: fmt.format(date),
    };
  } catch {
    // Fallback if Intl doesn't support persian calendar
    return {
      year: String(y),
      month: String(m),
      day: String(d),
      full: dateKey,
    };
  }
}

/** Converts Latin digits to Persian digits. */
function toPersianDigits(input) {
  return String(input).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
}

/* ------------------------------------------------------------
   Days strip — success heatmap grid
   ─────────────────────────────────────────────────────────────
   7 rows (Sat..Fri) × N columns (weeks). Every day of the plan
   is one cell. Cell color = adherence ratio (actual/planned),
   from deep red (missed) → deep green (over-achieved).
   ------------------------------------------------------------ */

/** Return the HSL background color for a given adherence ratio. */
function ratioToHsl(actual, planned) {
  // No planned session but some study happened = bonus → deep green
  if (planned <= 0) {
    if (actual > 0) return 'hsl(140, 68%, 40%)';
    return null; // neutral (no plan, no study)
  }

  const ratio = actual / planned;

  // Map ratio → hue: 0 = red, 1 = green, ≥1.25 = deep teal green
  const clamped = Math.max(0, Math.min(1.25, ratio));
  const hue = clamped * 120; // 0 → 0 (red), 1 → 120 (green), 1.25 → 150
  const sat = 62 + Math.min(18, clamped * 14);
  const light = 42 + (clamped > 1 ? (clamped - 1) * 8 : 0);

  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

Render.daysStrip = function () {
  const container = el.daysStrip;
  if (!container) return;

  // 1. Resolve plan date range (Settings first, then weekly plan)
  let startKey = state.doc.studyPlan?.startDate;
  let endKey = state.doc.studyPlan?.examDate;

  if (!startKey || !endKey) {
    const detected = getPlanDatesFromWeeklyPlan();
    if (detected) {
      startKey = detected.startDate;
      endKey = detected.examDate;
    }
  }

  if (!startKey || !endKey) {
    container.innerHTML = `<div class="empty-state" style="padding:20px 0;font-size:12px">${escapeHtml(
      tr().setExamDates || 'Set your study start date and exam date in Settings.'
    )}</div>`;
    return;
  }

  // 2. Build day-by-day range
  const today = todayKey();
  const [sy, sm, sd] = startKey.split('-').map(Number);
  const [ey, em, ed] = endKey.split('-').map(Number);
  const startMs = Date.UTC(sy, sm - 1, sd);
  const endMs = Date.UTC(ey, em - 1, ed);
  const totalDays = Math.round((endMs - startMs) / 86400000) + 1;

  if (totalDays <= 0 || totalDays > 1500) {
    container.innerHTML = `<div class="empty-state">—</div>`;
    return;
  }

  // 3. Build a lookup of planned minutes per date from the weekly plan
  const plannedByDate = new Map();
  try {
    const weeks = WeeklyPlanStore.getWeeks();
    for (const week of weeks) {
      const days = Array.isArray(week?.days) ? week.days : [];
      for (const day of days) {
        if (!day?.date) continue;
        const total = (Array.isArray(day.sessions) ? day.sessions : []).reduce(
          (sum, s) => sum + (Number(s.minutes) || 0),
          0
        );
        plannedByDate.set(day.date, total);
      }
    }
  } catch (err) {
    console.warn('Could not read weekly plan for days-strip:', err);
  }

  // 4. Determine first column offset (Saturday = col 0)
  const firstJsDay = new Date(startMs).getUTCDay(); // 0=Sun, 6=Sat
  const firstCol = (firstJsDay + 1) % 7; // Sat=0, Sun=1, ..., Fri=6

  const totalWeeks = Math.ceil((firstCol + totalDays) / 7);

  // 5. Build a 7×N grid of cells
  const grid = Array.from({ length: 7 }, () => Array(totalWeeks).fill(null));

  for (let i = 0; i < totalDays; i++) {
    const ms = startMs + i * 86400000;
    const d = new Date(ms);
    const key = d.toISOString().slice(0, 10);
    const jsDay = d.getUTCDay();
    const row = (jsDay + 1) % 7;
    const col = Math.floor((firstCol + i) / 7);

    const planned = plannedByDate.get(key) || 0;
    const actual = getActualMinutesForDate(key);

    let state_ = 'future';
    if (key < today) state_ = 'past';
    else if (key === today) state_ = 'today';

    // Color
    let color = null;
    if (state_ === 'past') {
      color = ratioToHsl(actual, planned);
    }

    // Persian date for tooltip
    const persian = getPersianDateParts(key);

    grid[row][col] = {
      key,
      state: state_,
      color,
      planned,
      actual,
      persian,
    };
  }

  // 6. Render
  const dayLabels = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج'];

  const labelsHtml = dayLabels.map((l) => `<span class="days-grid__label">${l}</span>`).join('');

  let cellsHtml = '';
  for (let row = 0; row < 7; row++) {
    for (let col = 0; col < totalWeeks; col++) {
      const c = grid[row][col];

      if (!c) {
        cellsHtml += `<div class="days-grid__cell days-grid__cell--empty"></div>`;
        continue;
      }

      const classes = ['days-grid__cell'];
      if (c.state === 'future') classes.push('days-grid__cell--future');
      if (c.state === 'today') classes.push('days-grid__cell--today');

      const style = c.color && c.state !== 'future' ? ` style="background:${c.color}"` : '';

      const pct = c.planned > 0 ? Math.round((c.actual / c.planned) * 100) : c.actual > 0 ? 100 : 0;

      const tooltipText =
        `${c.persian.full}\n` +
        `برنامه: ${Math.round(c.planned)}د\n` +
        `انجام: ${Math.round(c.actual)}د\n` +
        `موفقیت: ${pct}%`;

      cellsHtml += `<div class="${classes.join(' ')}" data-date="${c.key}" title="${escapeHtml(
        tooltipText
      )}"${style}></div>`;
    }
  }

  container.innerHTML = `
    <div class="days-grid">
      <div class="days-grid__labels">${labelsHtml}</div>
      <div class="days-grid__cells" style="--week-count:${totalWeeks}">${cellsHtml}</div>
    </div>
  `;

  // 7. Click handler → open day modal
  container.querySelectorAll('.days-grid__cell[data-date]').forEach((cell) => {
    cell.addEventListener('click', () => {
      const dateKey = cell.dataset.date;
      if (dateKey) openDayModal(dateKey);
    });
  });
};

/* ------------------------------------------------------------
   Translations / language / theme
   ------------------------------------------------------------ */
export function renderTranslations() {
  const t = tr();
  document.querySelectorAll('[data-i18n]').forEach((node) => {
    const text = t[node.dataset.i18n];
    if (text) node.textContent = text;
  });
  document.querySelectorAll('[data-i18n-placeholder]').forEach((node) => {
    const text = t[node.dataset.i18nPlaceholder];
    if (text) node.placeholder = text;
  });
  Render.resetCache();
}
export function applyLanguageAttributes() {
  const lang = state.doc.settings.language;
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === 'fa' ? 'rtl' : 'ltr';
  document.body.dataset.lang = lang;
  el.langFaBtn.classList.toggle('is-active', lang === 'fa');
  el.langEnBtn.classList.toggle('is-active', lang === 'en');
}
export function setLanguage(lang) {
  if (lang !== 'fa' && lang !== 'en') return;
  updateSettings({ language: lang });
  applyLanguageAttributes();
  renderTranslations();
  populateSettingsForm();
  Render.all();
  if (dayModalDate) renderDayModal(dayModalDate);
}
export function applyTheme() {
  el.body.setAttribute('data-theme', state.doc.settings.theme);
}
export function applyReducedMotion() {
  el.body.setAttribute('data-reduced-motion', String(state.doc.settings.reducedMotion));
}
export function toggleFullscreen() {
  if (!document.fullscreenElement) {
    document.documentElement.requestFullscreen().catch(() => {});
  } else {
    document.exitFullscreen().catch(() => {});
  }
}
/* ------------------------------------------------------------
   Toast / modals
   ------------------------------------------------------------ */
let toastTimer = null;
export function showToast(text, tone = 'info') {
  if (!el.toast) return;
  el.toastText.textContent = text;
  el.toast.dataset.tone = tone;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, 4500);
}
export function isAnyModalOpen() {
  return (
    !el.settingsModal.hidden ||
    !!(el.analysisModal && !el.analysisModal.hidden) ||
    !!(dayModalRoot && !dayModalRoot.hidden) ||
    !!(el.checkinModal && !el.checkinModal.hidden) // ← جدید
  );
}
/* ------------------------------------------------------------
   Day details modal
   Schema v4:
   Phase -> Week -> Day
   Day:
   {
     date,
     weekday,
     focus,
     englishMinutes
   }
   Week:
   {
     id,
     title,
     goal,
     targetMinutes,
     days
   }
   ------------------------------------------------------------ */
const DAY_HOUR_PX = 44;
const DAY_TABS = ['actual', 'plan', 'analysis'];
let dayModalRoot = null;
let dayModalRefs = null;
let dayModalDate = null;
let dayModalTab = 'actual';
function currentPlanLanguage() {
  return state.doc.settings.language || 'fa';
}
function formatDateKeyForModal(dateKey, language, options = {}) {
  const [year, month, day] = dateKey.split('-').map(Number);
  if (![year, month, day].every(Number.isFinite)) return dateKey;
  const date = new Date(Date.UTC(year, month - 1, day, 12, 0, 0));
  return date.toLocaleDateString(language === 'fa' ? 'fa-IR-u-ca-persian' : 'en-US', {
    timeZone: 'UTC',
    ...options,
  });
}
function formatPlanMinutes(value, language) {
  const minutes = Math.max(0, Math.round(Number(value) || 0));
  return minutes.toLocaleString(language === 'fa' ? 'fa-IR' : 'en-US');
}
function getWeeklyPlanDayContext(dateKey) {
  const weeks = WeeklyPlanStore.getWeeks();
  for (const week of weeks) {
    const days = Array.isArray(week?.days) ? week.days : [];
    const day = days.find((item) => item?.date === dateKey);
    if (day) {
      return {
        day,
        week,
      };
    }
  }
  return null;
}
function getActualMinutesForModalDay(dateKey) {
  return getDaySessions(dateKey).reduce((sum, rec) => {
    if (rec?.type !== 'study' && rec?.type !== 'review') return sum;
    return sum + (Number(rec?.derived?.activeDurationSeconds) || 0) / 60;
  }, 0);
}
function getDayPlanStatus(dateKey, actualMinutes, today) {
  if (dateKey > today) {
    return 'future';
  }
  if (dateKey === today) {
    return 'today';
  }
  return actualMinutes > 0 ? 'partial' : 'missed';
}
function getDayModalStatusLabel(status, fa) {
  const labels = {
    future: fa ? 'پیش‌رو' : 'Upcoming',
    today: fa ? 'امروز' : 'Today',
    partial: fa ? 'ثبت شده' : 'Recorded',
    missed: fa ? 'بدون ثبت' : 'No record',
  };
  return labels[status] || status;
}
function getDayBlocks(dateKey) {
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
      return {
        rec,
        startMin: (start - dayStart) / 60000,
        endMin: (end - dayStart) / 60000,
      };
    })
    .filter(Boolean);
}
function blockKind(rec) {
  if (rec.type === 'break') return 'break';
  return rec.type; // study | practice | test | analysis | review
}
function kindLabelOf(kind, t) {
  if (kind === 'break') return t.break;
  if (kind === 'practice') return t.kindPractice;
  if (kind === 'test') return t.kindTest;
  if (kind === 'analysis') return t.kindAnalysis;
  if (kind === 'review') return t.kindReview;
  return t.kindStudy;
}
function layoutLanes(items) {
  const sorted = items.slice().sort((a, b) => a.startMin - b.startMin || b.endMin - a.endMin);
  let cluster = [];
  let clusterEnd = -1;
  let laneEnds = [];
  const flush = () => {
    const total = Math.max(1, laneEnds.length);
    cluster.forEach((item) => {
      item.lanes = total;
    });
    cluster = [];
    laneEnds = [];
    clusterEnd = -1;
  };
  sorted.forEach((item) => {
    if (cluster.length && item.startMin >= clusterEnd) flush();
    let lane = laneEnds.findIndex((end) => end <= item.startMin);
    if (lane === -1) {
      lane = laneEnds.length;
      laneEnds.push(item.endMin);
    } else {
      laneEnds[lane] = item.endMin;
    }
    item.lane = lane;
    cluster.push(item);
    clusterEnd = Math.max(clusterEnd, item.endMin);
  });
  flush();
  return sorted;
}
function dayTimelineHtml(blocksMarkup, dateKey, today) {
  const hourRows = Array.from(
    { length: 24 },
    (_, h) => `
      <div class="day-timeline__hour" style="top:${h * DAY_HOUR_PX}px;height:${DAY_HOUR_PX}px">
        <span class="day-timeline__hour-label">${String(h).padStart(2, '0')}:00</span>
      </div>`
  ).join('');
  let nowLine = '';
  if (dateKey === today) {
    const now = new Date();
    const nowMin = now.getHours() * 60 + now.getMinutes();
    nowLine = `<div class="day-timeline__now" style="top:${(nowMin / 60) * DAY_HOUR_PX}px"></div>`;
  }
  return `${hourRows}<div class="day-timeline__track">${blocksMarkup}</div>${nowLine}`;
}
function dayStat(label, value) {
  return `<div class="day-modal__stat"><span>${label}</span><strong>${value}</strong></div>`;
}
function ensureDayModal() {
  if (dayModalRoot) return dayModalRefs;
  const root = document.createElement('div');
  root.className = 'modal';
  root.id = 'dayModal';
  root.hidden = true;
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = `
    <div class="modal__backdrop" data-close-day-modal></div>
    <div class="modal__dialog day-dialog" role="dialog" aria-modal="true" aria-labelledby="dayModalTitle">
      <div class="modal__header">
        <div class="day-modal__heading">
          <h2 id="dayModalTitle"></h2>
          <p class="settings-hint" id="dayModalSubtitle"></p>
        </div>
        <button type="button" class="modal-close" id="dayModalCloseBtn" aria-label="Close" title="Close">×</button>
      </div>
      <div class="modal__body">
        <div class="day-tabs" id="dayModalTabs" role="tablist">
          <button type="button" class="day-tab" role="tab" id="dayTabActual" data-day-tab="actual" aria-controls="dayPanelActual"></button>
          <button type="button" class="day-tab" role="tab" id="dayTabPlan" data-day-tab="plan" aria-controls="dayPanelPlan"></button>
          <button type="button" class="day-tab" role="tab" id="dayTabAnalysis" data-day-tab="analysis" aria-controls="dayPanelAnalysis"></button>
        </div>
        <section class="day-panel" id="dayPanelActual" role="tabpanel" data-day-panel="actual" aria-labelledby="dayTabActual">
          <div class="day-modal__summary" id="dayModalSummary"></div>
          <div class="section-label" id="dayModalTimelineLabel"></div>
          <div class="empty-state" id="dayModalTimelineEmpty" hidden></div>
          <div class="day-timeline__scroll" id="dayModalScroll">
            <div class="day-timeline" id="dayModalTimeline"></div>
          </div>
          <div class="day-legend" id="dayModalLegend"></div>
        </section>
        <section class="day-panel" id="dayPanelPlan" role="tabpanel" data-day-panel="plan" aria-labelledby="dayTabPlan" hidden>
          <div class="day-modal__summary" id="dayPlanSummary"></div>
          <div class="section-label" id="dayPlanListLabel"></div>
          <div class="plan-agenda" id="dayPlanSessions"></div>
          <div class="weekly-plan-day__note" id="dayPlanNote" hidden></div>
          <div id="dayPlanMix"></div>
          <div class="section-label" id="dayPlanClockLabel"></div>
          <div class="empty-state" id="dayPlanClockEmpty" hidden></div>
          <div class="day-timeline__scroll" id="dayPlanScroll" hidden>
            <div class="day-timeline" id="dayPlanTimeline"></div>
          </div>
        </section>
        <section class="day-panel" id="dayPanelAnalysis" role="tabpanel" data-day-panel="analysis" aria-labelledby="dayTabAnalysis" hidden>
          <div id="dayAnalysisBody"></div>
        </section>
      </div>
    </div>
  `;
  document.body.appendChild(root);
  root.addEventListener('click', (event) => {
    const tabBtn = event.target.closest('[data-day-tab]');
    if (tabBtn) {
      dayModalTab = tabBtn.dataset.dayTab;
      applyDayTab();
      return;
    }
    if (
      event.target.closest('[data-close-day-modal]') ||
      event.target.closest('#dayModalCloseBtn')
    ) {
      closeDayModal();
    }
  });
  root.querySelector('#dayModalTabs').addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    const rtl = document.documentElement.dir === 'rtl';
    const step = (event.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1);
    const next = (DAY_TABS.indexOf(dayModalTab) + step + DAY_TABS.length) % DAY_TABS.length;
    dayModalTab = DAY_TABS[next];
    applyDayTab();
    root.querySelector(`[data-day-tab="${dayModalTab}"]`).focus();
    event.preventDefault();
  });
  dayModalRoot = root;
  dayModalRefs = {
    title: root.querySelector('#dayModalTitle'),
    subtitle: root.querySelector('#dayModalSubtitle'),
    tabActual: root.querySelector('#dayTabActual'),
    tabPlan: root.querySelector('#dayTabPlan'),
    tabAnalysis: root.querySelector('#dayTabAnalysis'),
    summary: root.querySelector('#dayModalSummary'),
    timelineLabel: root.querySelector('#dayModalTimelineLabel'),
    timelineEmpty: root.querySelector('#dayModalTimelineEmpty'),
    scroll: root.querySelector('#dayModalScroll'),
    timeline: root.querySelector('#dayModalTimeline'),
    legend: root.querySelector('#dayModalLegend'),
    planSummary: root.querySelector('#dayPlanSummary'),
    planMix: root.querySelector('#dayPlanMix'),
    planClockLabel: root.querySelector('#dayPlanClockLabel'),
    planClockEmpty: root.querySelector('#dayPlanClockEmpty'),
    planScroll: root.querySelector('#dayPlanScroll'),
    planTimeline: root.querySelector('#dayPlanTimeline'),
    planListLabel: root.querySelector('#dayPlanListLabel'),
    planSessions: root.querySelector('#dayPlanSessions'),
    planNote: root.querySelector('#dayPlanNote'),
    analysisBody: root.querySelector('#dayAnalysisBody'),
  };
  return dayModalRefs;
}
function applyDayTab() {
  if (!dayModalRoot) return;
  DAY_TABS.forEach((name) => {
    const active = name === dayModalTab;
    const btn = dayModalRoot.querySelector(`[data-day-tab="${name}"]`);
    const panel = dayModalRoot.querySelector(`[data-day-panel="${name}"]`);
    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
    btn.tabIndex = active ? 0 : -1;
    panel.hidden = !active;
  });
  requestAnimationFrame(scrollDayTimeline);
}
function scrollDayTimeline() {
  if (!dayModalRoot || dayModalRoot.hidden || !dayModalRefs) return;
  const scrollEl =
    dayModalTab === 'actual'
      ? dayModalRefs.scroll
      : dayModalTab === 'plan'
        ? dayModalRefs.planScroll
        : null;
  if (!scrollEl || scrollEl.hidden) return;
  const focusMin = Number(scrollEl.dataset.focus);
  const minutes = Number.isFinite(focusMin) ? focusMin : 6 * 60;
  scrollEl.scrollTop = Math.max(0, (minutes / 60) * DAY_HOUR_PX - DAY_HOUR_PX);
}
/* ------------------------------------------------------------
   Tab 1: Recorded
   ------------------------------------------------------------ */
function renderDayActualTab(refs, ctx) {
  const { dateKey, dayStatus, fa, t, today, actualMinutes } = ctx;
  const statusLabel = getDayModalStatusLabel(dayStatus.status, fa);
  const blocks = getDayBlocks(dateKey);
  const workBlocks = blocks.filter(({ rec }) => rec.type === 'study' || rec.type === 'review');
  const sessionCount = workBlocks.length;
  refs.summary.dataset.status = dayStatus.status;
  refs.summary.innerHTML = [
    dayStat(fa ? 'زمان مطالعه' : 'Focus time', fmtHoursMinutes(Math.round(actualMinutes) * 60)),
    dayStat(fa ? 'تعداد جلسه' : 'Sessions', String(sessionCount)),
    dayStat(fa ? 'وضعیت' : 'Status', statusLabel),
  ].join('');
  refs.timelineLabel.textContent = fa
    ? 'ساعت شبانه‌روز · جلسه‌های ثبت‌شده'
    : 'Time of day · recorded sessions';
  const blockMarkup = blocks
    .map(({ rec, startMin, endMin }) => {
      const kind = blockKind(rec);
      const top = (startMin / 60) * DAY_HOUR_PX;
      const height = Math.max(18, ((endMin - startMin) / 60) * DAY_HOUR_PX);
      const startedAt = fromIso(rec.actual.startedAt);
      const endedAt = fromIso(rec.actual.endedAt);
      const range = `${fmtClock(startedAt)}–${fmtClock(endedAt)}`;
      const duration = fmtHoursMinutes(rec.derived.activeDurationSeconds);
      const name =
        kind === 'break' ? t.break : `${rec.subject || t.noSubject} · ${kindLabelOf(kind, t)}`;
      const extra = kind === 'break' ? '' : rec.topic || '';
      const tooltip = [name, range, duration, extra].filter(Boolean).join(' · ');
      const compact = height < 34;
      return `
        <div class="day-block kc-${kind}${compact ? ' day-block--compact' : ''}" style="top:${top}px;height:${height}px" title="${escapeHtml(tooltip)}">
          <span class="day-block__name">${escapeHtml(name)}</span>
          ${compact ? '' : `<span class="day-block__meta">${range} · ${duration}</span>`}
          ${compact || !extra ? '' : `<span class="day-block__topic">${escapeHtml(extra)}</span>`}
        </div>`;
    })
    .join('');
  refs.timeline.style.height = `${24 * DAY_HOUR_PX}px`;
  refs.timeline.innerHTML = dayTimelineHtml(blockMarkup, dateKey, today);
  refs.timelineEmpty.hidden = blocks.length > 0;
  refs.timelineEmpty.textContent =
    dateKey > today
      ? fa
        ? 'این روز هنوز نرسیده؛ جزئیات برنامه را در تب «برنامه» ببینید.'
        : "This day hasn't happened yet — see the Plan tab."
      : fa
        ? 'برای این روز جلسه‌ای ثبت نشده است.'
        : 'No sessions were recorded for this day.';
  const kindsUsed = [...new Set(blocks.map(({ rec }) => blockKind(rec)))];
  refs.legend.innerHTML = kindsUsed
    .map(
      (kind) =>
        `<span class="day-legend__item kc-${kind}"><i class="day-legend__dot"></i>${kindLabelOf(kind, t)}</span>`
    )
    .join('');
  let focusMin = 6 * 60;
  if (blocks.length) {
    focusMin = Math.min(...blocks.map((block) => block.startMin));
  } else if (dateKey === today) {
    focusMin = new Date().getHours() * 60;
  }
  refs.scroll.dataset.focus = String(focusMin);
}
/* ------------------------------------------------------------
   Tab 2: Plan
   ------------------------------------------------------------ */
function renderDayPlanTab(refs, ctx) {
  const { day, week, dateKey, dayStatus, fa, language, today, actualMinutes } = ctx;
  const L = (faText, enText) => (fa ? faText : enText);

  const summary = computeDaySummary(day);
  const sessions = Array.isArray(day?.sessions) ? day.sessions : [];

  const weekTarget = Math.max(0, Number(week?.targetMinutes) || 0);
  const weekTitle = week?.title || week?.id || L('هفته برنامه', 'Study week');
  const weekGoal = week?.goal || '';
  const statusLabel = getDayModalStatusLabel(dayStatus.status, fa);
  const actualLabel = formatPlanMinutes(actualMinutes, language);
  const englishLabel = formatPlanMinutes(summary.english, language);
  const targetLabel = formatPlanMinutes(weekTarget, language);

  refs.planSummary.innerHTML = [
    dayStat(L('تعداد جلسات', 'Sessions'), String(sessions.length)),
    dayStat(
      L('مجموع برنامه', 'Planned minutes'),
      `${formatPlanMinutes(summary.total, language)} ${L('دقیقه', 'min')}`
    ),
    dayStat(L('زبان تخصصی', 'Specialized English'), `${englishLabel} ${L('دقیقه', 'min')}`),
    dayStat(L('وضعیت روز', 'Day status'), statusLabel),
    dayStat(L('مطالعه ثبت‌شده', 'Recorded study'), `${actualLabel} ${L('دقیقه', 'min')}`),
  ].join('');

  refs.planListLabel.textContent = L('جلسات برنامه‌ریزی‌شده', 'Planned sessions');

  if (!sessions.length) {
    refs.planSessions.innerHTML = `
      <div class="empty-state">${L(
        'برای این روز جلسه‌ای برنامه‌ریزی نشده است.',
        'No sessions planned for this day.'
      )}</div>
    `;
  } else {
    refs.planSessions.innerHTML = sessions
      .map(
        (s) => `
      <div class="weekly-plan-session">
        <div class="weekly-plan-session__main">
          <span class="weekly-plan-session__time">${escapeHtml(s.startTime)}–${escapeHtml(s.endTime)}</span>
          <span class="weekly-plan-session__subject">${escapeHtml(s.subject)} — ${escapeHtml(s.topic)}</span>
        </div>
        <span class="weekly-plan-session__minutes">${s.minutes}${L('د', 'm')}</span>
      </div>`
      )
      .join('');
  }

  refs.planNote.hidden = !weekGoal;
  refs.planNote.textContent = weekGoal;

  refs.planMix.innerHTML = `
    <div class="section-label">${L('هفته‌ی برنامه', 'Study week')}</div>
    <div class="day-modal__summary">
      ${dayStat(L('هفته', 'Week'), escapeHtml(weekTitle))}
      ${weekTarget > 0 ? dayStat(L('هدف هفتگی', 'Weekly target'), `${targetLabel} ${L('دقیقه', 'min')}`) : ''}
      ${weekGoal ? dayStat(L('هدف هفته', 'Week goal'), escapeHtml(weekGoal)) : ''}
    </div>
  `;

  refs.planClockLabel.textContent = L('برنامه روی ساعت شبانه‌روز', 'Plan on the clock');
  refs.planClockEmpty.hidden = false;
  refs.planClockEmpty.textContent = L(
    'برای هر جلسه ساعت شروع و پایان در برنامه تعریف شده است؛ اما نمایش timeline ساعتی در این نسخه فعال نیست.',
    'Each session has start/end times in the plan; hourly timeline display is not enabled in this version.'
  );
  refs.planScroll.hidden = true;
  refs.planTimeline.innerHTML = '';
  refs.planScroll.dataset.focus = String(dateKey === today ? new Date().getHours() * 60 : 6 * 60);
}
/* ------------------------------------------------------------
   Tab 3: Analysis
   ------------------------------------------------------------ */
function renderDayAnalysisTab(refs, ctx) {
  const { dateKey, day, week, fa, t, today, actualMinutes, dayStatus } = ctx;
  const L = (faText, enText) => (fa ? faText : enText);
  const sec = (record) => Number(record?.derived?.activeDurationSeconds) || 0;
  const toMs = (iso) => new Date(fromIso(iso)).getTime();
  const recs = getDaySessions(dateKey).filter(
    (record) => record?.actual?.startedAt && record?.actual?.endedAt && record?.derived
  );
  if (!recs.length) {
    refs.analysisBody.innerHTML = `
      <div class="empty-state">
        ${
          dateKey > today
            ? L(
                'این روز هنوز نرسیده؛ بعد از ثبت جلسه‌ها تحلیل اینجا نمایش داده می‌شود.',
                "This day hasn't happened yet — analysis will appear after sessions are recorded."
              )
            : L(
                'برای این روز داده‌ای برای تحلیل ثبت نشده است.',
                'No recorded data is available for this day.'
              )
        }
      </div>
      <div class="day-modal__summary">
        ${dayStat(L('تمرکز برنامه', 'Planned focus'), escapeHtml(day?.focus || '—'))}
        ${dayStat(L('هدف هفتگی', 'Weekly target'), `${formatPlanMinutes(week?.targetMinutes, ctx.language)} ${L('دقیقه', 'min')}`)}
      </div>
    `;
    return;
  }
  const work = recs.filter((record) => record.type === 'study' || record.type === 'review');
  const focusSec = work.reduce((sum, record) => sum + sec(record), 0);
  const breakSec = recs
    .filter((record) => record.type === 'break')
    .reduce((sum, record) => sum + sec(record), 0);
  const longestSec = Math.max(0, ...work.map(sec));
  const avgSec = work.length ? focusSec / work.length : 0;
  const firstMs = Math.min(...recs.map((record) => toMs(record.actual.startedAt)));
  const lastMs = Math.max(...recs.map((record) => toMs(record.actual.endedAt)));
  const hours = Array(24).fill(0);
  getDayBlocks(dateKey).forEach(({ rec, startMin, endMin }) => {
    if (rec.type !== 'study' && rec.type !== 'review') return;
    const span = endMin - startMin;
    const activeMinutes = sec(rec) / 60;
    const ratio = span > 0 ? Math.min(1, activeMinutes / span) : 0;
    for (let h = Math.floor(startMin / 60); h <= Math.floor((endMin - 0.001) / 60); h += 1) {
      const overlap = Math.min(endMin, (h + 1) * 60) - Math.max(startMin, h * 60);
      if (overlap > 0) {
        hours[h] += overlap * ratio;
      }
    }
  });
  const maxHour = Math.max(...hours);
  const peakHour = maxHour > 0 ? hours.indexOf(maxHour) : -1;
  const kpis = [
    dayStat(L('زمان مطالعه', 'Focus time'), fmtHoursMinutes(focusSec)),
    dayStat(L('تعداد جلسه', 'Sessions'), String(work.length)),
    dayStat(L('میانگین هر جلسه', 'Avg session'), fmtHoursMinutes(avgSec)),
    dayStat(L('طولانی‌ترین جلسه', 'Longest session'), fmtHoursMinutes(longestSec)),
    dayStat(L('استراحت', 'Breaks'), fmtHoursMinutes(breakSec)),
    dayStat(L('بازه‌ی فعالیت', 'Active window'), `${fmtClock(firstMs)}–${fmtClock(lastMs)}`),
    peakHour >= 0
      ? dayStat(L('پرتمرکزترین ساعت', 'Peak hour'), `${String(peakHour).padStart(2, '0')}:00`)
      : '',
    dayStat(L('تمرکز برنامه', 'Planned focus'), escapeHtml(day?.focus || '—')),
  ].join('');
  const subjectTotals = new Map();
  work.forEach((record) => {
    const subject = record.subject || t.noSubject;
    const current = subjectTotals.get(subject) || 0;
    subjectTotals.set(subject, current + sec(record) / 60);
  });
  const subjectRows = [...subjectTotals.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(
      ([subject, minutes]) => `
        <div class="day-bar-row">
          <div class="day-bar-row__head">
            <span>${escapeHtml(subject)}</span>
            <span class="day-bar-row__nums">${Math.round(minutes)} ${L('دقیقه', 'min')}</span>
          </div>
          <div class="day-bar">
            <span class="day-bar__actual kc-study" style="width:${focusSec > 0 ? ((minutes * 60) / focusSec) * 100 : 0}%"></span>
          </div>
        </div>`
    )
    .join('');
  const kindTotals = { study: 0, practice: 0, test: 0, analysis: 0, review: 0, break: 0 };
  recs.forEach((record) => {
    const kind = blockKind(record);
    kindTotals[kind] = (kindTotals[kind] || 0) + sec(record);
  });
  const totalSec = Object.values(kindTotals).reduce((sum, value) => sum + value, 0) || 1;
  let accumulated = 0;
  const donutSegs = Object.entries(kindTotals)
    .filter(([, seconds]) => seconds > 0)
    .map(([kind, seconds]) => {
      const percent = (seconds / totalSec) * 100;
      const segment = `<circle class="day-donut__seg kc-${kind}" cx="21" cy="21" r="15.9155" fill="none" stroke-width="5" stroke-dasharray="${percent} ${100 - percent}" stroke-dashoffset="${25 - accumulated}"></circle>`;
      accumulated += percent;
      return segment;
    })
    .join('');
  const donutLegend = Object.entries(kindTotals)
    .filter(([, seconds]) => seconds > 0)
    .map(
      ([kind, seconds]) => `
        <div class="day-donut__legend-row kc-${kind}">
          <i class="day-legend__dot"></i>
          <span class="day-donut__legend-name">${kindLabelOf(kind, t)}</span>
          <span class="day-donut__legend-val">${fmtHoursMinutes(seconds)} · ${Math.round((seconds / totalSec) * 100)}%</span>
        </div>`
    )
    .join('');
  const hourCols = hours
    .map((minutes, hour) => {
      const label = String(hour).padStart(2, '0');
      return `
        <div class="day-hours__col${hour === peakHour ? ' is-peak' : ''}" title="${label}:00 · ${Math.round(minutes)} ${L('دقیقه', 'min')}">
          <div class="day-hours__area">
            <span class="day-hours__bar" style="height:${maxHour ? (minutes / maxHour) * 100 : 0}%"></span>
          </div>
          <span class="day-hours__tick">${hour % 3 === 0 ? label : ''}</span>
        </div>`;
    })
    .join('');
  const testRows = recs.filter((record) => {
    if (record.type !== 'analysis') return false;
    const analysis = record.analysis || {};
    return [analysis.testCount, analysis.correctPercent, analysis.analyzedErrorCount].some(
      (value) => value !== null && value !== undefined
    );
  });
  let testsMarkup = '';
  if (testRows.length) {
    const valueOrDash = (value, suffix = '') =>
      value === null || value === undefined ? '—' : `${value}${suffix}`;
    const weighted = testRows.filter(
      (record) =>
        Number(record.analysis?.testCount) > 0 &&
        record.analysis?.correctPercent !== null &&
        record.analysis?.correctPercent !== undefined
    );
    const totalQuestions = weighted.reduce(
      (sum, record) => sum + Number(record.analysis.testCount || 0),
      0
    );
    const averageCorrect = totalQuestions
      ? weighted.reduce(
          (sum, record) =>
            sum +
            Number(record.analysis.testCount || 0) * Number(record.analysis.correctPercent || 0),
          0
        ) / totalQuestions
      : null;
    testsMarkup = `
      <div class="section-label">${L('نتایج تحلیل آزمون', 'Test analysis results')}</div>
      <div class="day-table__wrap">
        <table class="day-table">
          <thead>
            <tr>
              <th>${L('درس / مبحث', 'Subject / topic')}</th>
              <th>${L('تعداد تست', 'Questions')}</th>
              <th>${L('درصد صحیح', 'Correct')}</th>
              <th>${L('خطاها', 'Errors')}</th>
            </tr>
          </thead>
          <tbody>
            ${testRows
              .map(
                (record) => `
                  <tr>
                    <td>${escapeHtml([record.subject, record.topic].filter(Boolean).join(' · ') || t.noSubject)}</td>
                    <td>${valueOrDash(record.analysis?.testCount)}</td>
                    <td>${valueOrDash(record.analysis?.correctPercent, '%')}</td>
                    <td>${valueOrDash(record.analysis?.analyzedErrorCount)}</td>
                  </tr>`
              )
              .join('')}
          </tbody>
        </table>
      </div>
      ${
        averageCorrect !== null
          ? `<p class="settings-hint">${L('میانگین وزنی درصد صحیح', 'Weighted average correct')}: <strong>${Math.round(averageCorrect * 10) / 10}%</strong> (${totalQuestions} ${L('تست', 'questions')})</p>`
          : ''
      }
    `;
  }
  const topics = [...new Set(work.map((record) => record.topic).filter(Boolean))];
  const topicsMarkup = topics.length
    ? `
      <div class="section-label">${L('مباحث خوانده‌شده', 'Topics covered')}</div>
      <div class="day-chips">
        ${topics.map((topic) => `<span class="day-chip">${escapeHtml(topic)}</span>`).join('')}
      </div>`
    : '';
  refs.analysisBody.innerHTML = `
    <div class="day-modal__summary">${kpis}</div>
    ${
      subjectRows
        ? `
          <div class="section-label">${L('زمان مطالعه به تفکیک درس', 'Study time by subject')}</div>
          <div class="day-bar-list">${subjectRows}</div>
        `
        : ''
    }
    <div class="section-label">${L('زمان به تفکیک نوع فعالیت', 'Time by activity')}</div>
    <div class="day-donut">
      <svg class="day-donut__svg" viewBox="0 0 42 42" role="img" aria-label="${L('نمودار حلقه‌ای', 'Donut chart')}">
        <circle class="day-donut__track" cx="21" cy="21" r="15.9155" fill="none" stroke-width="5"></circle>
        ${donutSegs}
        <text x="21" y="21" text-anchor="middle" dominant-baseline="central" class="day-donut__total">${fmtHoursMinutes(totalSec)}</text>
      </svg>
      <div class="day-donut__legend">${donutLegend}</div>
    </div>
    <div class="section-label">${L('تمرکز در هر ساعت از شبانه‌روز', 'Focus by hour of day')}</div>
    <div class="day-hours" role="img" aria-label="${L('نمودار میله‌ای ساعتی', 'Hourly bar chart')}">${hourCols}</div>
    ${testsMarkup}
    ${topicsMarkup}
  `;
}
function renderDayModal(dateKey) {
  const planContext = getWeeklyPlanDayContext(dateKey);
  if (!planContext) return;
  const refs = ensureDayModal();
  const language = currentPlanLanguage();
  const fa = language === 'fa';
  const today = todayKey();
  const actualMinutes = getActualMinutesForModalDay(dateKey);
  const dayStatus = {
    status: getDayPlanStatus(dateKey, actualMinutes, today),
    actualMinutes,
  };
  const ctx = {
    dateKey,
    day: planContext.day,
    week: planContext.week,
    dayStatus,
    actualMinutes,
    language,
    fa,
    t: tr(),
    today,
  };
  const dateLabel = formatDateKeyForModal(dateKey, language, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });
  const daySum = computeDaySummary(planContext.day);
  refs.title.textContent = daySum.focus || planContext.week.title || dateLabel;
  refs.subtitle.textContent = `${dateLabel} · ${dateKey}`;
  refs.tabActual.textContent = fa ? 'انجام‌شده' : 'Recorded';
  refs.tabPlan.textContent = fa ? 'برنامه' : 'Plan';
  refs.tabAnalysis.textContent = fa ? 'تحلیل' : 'Analysis';
  renderDayActualTab(refs, ctx);
  renderDayPlanTab(refs, ctx);
  renderDayAnalysisTab(refs, ctx);
  applyDayTab();
}
export function openDayModal(dateKey) {
  if (!getWeeklyPlanDayContext(dateKey)) return;
  ensureDayModal();
  dayModalDate = dateKey;
  dayModalRoot.hidden = false;
  dayModalRoot.setAttribute('aria-hidden', 'false');
  renderDayModal(dateKey);
}
export function closeDayModal() {
  if (!dayModalRoot) return;
  dayModalDate = null;
  dayModalRoot.hidden = true;
  dayModalRoot.setAttribute('aria-hidden', 'true');
}
// Click / keyboard on any day card (event delegation: cards are re-created on every render).
if (el.weeklyPlanDays) {
  el.weeklyPlanDays.addEventListener('click', (event) => {
    const target = event.target;
    if (!(target instanceof Element)) return;
    const card = target.closest('.weekly-plan-day[data-date]');
    if (!card) return;
    const dateKey = card.dataset.date;
    if (!dateKey) return;
    openDayModal(dateKey);
  });
  el.weeklyPlanDays.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const target = event.target;
    if (!(target instanceof Element)) return;
    const card = target.closest('.weekly-plan-day[data-date]');
    if (!card) return;
    const dateKey = card.dataset.date;
    if (!dateKey) return;
    event.preventDefault();
    openDayModal(dateKey);
  });
}
document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && dayModalRoot && !dayModalRoot.hidden) {
    closeDayModal();
    return;
  }
});
/* ------------------------------------------------------------
   Post-session modal: topic picker (study/practice/review) + full
   test-analysis metrics (review only)
   ------------------------------------------------------------ */
let analysisSessionId = null;
let analysisSessionType = 'study';
/** Fills the topic <datalist> with this subject's topics (or all topics if no subject). */
function populateTopicOptions(subject) {
  if (!el.analysisTopicOptions) return;
  const topics = subject ? getTopicsForSubject(subject) : getAllTopics();
  el.analysisTopicOptions.replaceChildren();
  topics.forEach((topic) => {
    const opt = document.createElement('option');
    opt.value = topic;
    el.analysisTopicOptions.appendChild(opt);
  });
}
/** Opens the modal pre-filled with rec.topic (+ rec.analysis for review), remembering rec.id/type for the Save handler. */
export function openAnalysisModal(rec) {
  const isAnalysis = analysisSessionType === 'analysis';

  const t = tr();

  if (el.analysisModalTitleEl) {
    el.analysisModalTitleEl.textContent = isAnalysis ? t.analysisModalTitle : t.topicModalTitle;
  }
  if (el.analysisModalSubtitleEl) {
    el.analysisModalSubtitleEl.textContent = isAnalysis
      ? t.analysisModalSubtitle
      : t.topicModalSubtitle;
  }
  if (el.analysisMetricsSection) {
    el.analysisMetricsSection.hidden = !isAnalysis;
  }

  if (!el.analysisModal || !rec) return;

  analysisSessionId = rec.id ?? null;
  analysisSessionType = rec.type || 'study';
  const isReview = analysisSessionType === 'review';
  const analysis = rec.analysis && typeof rec.analysis === 'object' ? rec.analysis : {};
  if (el.analysisSubjectLabel) {
    el.analysisSubjectLabel.textContent = rec.subject || t.noSubject;
  }
  if (el.analysisModalTitleEl) {
    el.analysisModalTitleEl.textContent = isReview ? t.analysisModalTitle : t.topicModalTitle;
  }
  if (el.analysisModalSubtitleEl) {
    el.analysisModalSubtitleEl.textContent = isReview
      ? t.analysisModalSubtitle
      : t.topicModalSubtitle;
  }
  populateTopicOptions(rec.subject);
  if (el.analysisTopic) {
    el.analysisTopic.value = typeof rec.topic === 'string' ? rec.topic : '';
  }
  if (el.analysisMetricsSection) {
    el.analysisMetricsSection.hidden = !isReview;
  }
  if (el.analysisTestCount) {
    el.analysisTestCount.value = analysis.testCount ?? '';
  }
  if (el.analysisCorrectPercent) {
    el.analysisCorrectPercent.value = analysis.correctPercent ?? '';
  }
  if (el.analysisErrorCount) {
    el.analysisErrorCount.value = analysis.analyzedErrorCount ?? '';
  }
  el.analysisModal.hidden = false;
  el.analysisModal.setAttribute('aria-hidden', 'false');
}
export function closeAnalysisModal() {
  if (!el.analysisModal) return;
  analysisSessionId = null;
  analysisSessionType = 'study';
  el.analysisModal.hidden = true;
  el.analysisModal.setAttribute('aria-hidden', 'true');
}
export function getAnalysisModalSessionId() {
  return analysisSessionId;
}
export function getAnalysisModalSessionType() {
  return analysisSessionType;
}
/** Reads the topic and test-analysis fields. Returns null when any filled metric is invalid. */
export function readAnalysisForm() {
  const parseIntegerOrNull = (input, max) => {
    if (!input || input.value.trim() === '') {
      return { value: null, ok: true };
    }
    const value = Number(input.value);
    if (!Number.isFinite(value) || !Number.isInteger(value) || value < 0 || value > max) {
      return { value: null, ok: false };
    }
    return { value, ok: true };
  };
  const parsePercentOrNull = (input) => {
    if (!input || input.value.trim() === '') {
      return { value: null, ok: true };
    }
    const value = Number(input.value);
    if (!Number.isFinite(value) || value < 0 || value > 100) {
      return { value: null, ok: false };
    }
    return { value, ok: true };
  };
  const testCount = parseIntegerOrNull(el.analysisTestCount, 10000);
  const correctPercent = parsePercentOrNull(el.analysisCorrectPercent);
  const analyzedErrorCount = parseIntegerOrNull(el.analysisErrorCount, 10000);
  let topic = null;
  if (el.analysisTopic) {
    const trimmed = el.analysisTopic.value.trim();
    if (trimmed) {
      if (trimmed.length > 80) return null;
      topic = trimmed;
    }
  }
  if (!testCount.ok || !correctPercent.ok || !analyzedErrorCount.ok) {
    return null;
  }
  return {
    topic,
    testCount: testCount.value,
    correctPercent: correctPercent.value,
    analyzedErrorCount: analyzedErrorCount.value,
  };
}

/* ------------------------------------------------------------
   Daily check-in modal
   ------------------------------------------------------------ */

let checkinDateKey = null;

/** باز کردن مودال. اگر entries[today] موجود بود، فرم را از پیش پر می‌کند. */
export function openCheckinModal(dateKey, existingEntry = null) {
  if (!el.checkinModal) return;
  checkinDateKey = dateKey;

  const d = existingEntry || null;

  el.checkinBedTime.value = d?.sleep?.bedTime ?? '';
  el.checkinWakeTime.value = d?.sleep?.wakeTime ?? '';
  el.checkinSleepHours.value = d?.sleep?.hours ?? '';
  el.checkinSleepQuality.value = d?.sleep?.quality ?? 5;
  el.checkinSleepQualityValue.textContent = el.checkinSleepQuality.value;

  el.checkinRoutineDone.checked = Boolean(d?.relaxationRoutine?.done);
  el.checkinRoutineSteps.value = d?.relaxationRoutine?.steps ?? '';
  el.checkinRoutineStepsWrap.hidden = !el.checkinRoutineDone.checked;

  el.checkinActivity1.checked = d?.activity1 === true;
  el.checkinOperation1.checked = d?.operation1 === true;

  el.checkinYesterdayQuality.value = d?.yesterdayQuality ?? 5;
  el.checkinYesterdayQualityValue.textContent = el.checkinYesterdayQuality.value;

  el.checkinExerciseDone.checked = Boolean(d?.exercise?.done);
  el.checkinExerciseMinutes.value = d?.exercise?.minutes ?? '';
  el.checkinExerciseMinutesWrap.hidden = !el.checkinExerciseDone.checked;

  el.checkinModal.hidden = false;
  el.checkinModal.setAttribute('aria-hidden', 'false');
  setTimeout(() => el.checkinBedTime.focus(), 50);
}

export function closeCheckinModal() {
  if (!el.checkinModal) return;
  checkinDateKey = null;
  el.checkinModal.hidden = true;
  el.checkinModal.setAttribute('aria-hidden', 'true');
}

export function getCheckinDateKey() {
  return checkinDateKey;
}

/** خواندن فرم. اگر مقدار نامعتبر بود null برمی‌گرداند. */
export function readCheckinForm() {
  const parseOptInt = (input, max) => {
    const v = input.value.trim();
    if (!v) return { value: null, ok: true };
    const n = Number(v);
    if (!Number.isFinite(n) || !Number.isInteger(n) || n < 0 || n > max) {
      return { value: null, ok: false };
    }
    return { value: n, ok: true };
  };

  const parseOptFloat = (input, min, max) => {
    const v = input.value.trim();
    if (!v) return { value: null, ok: true };
    const n = Number(v);
    if (!Number.isFinite(n) || n < min || n > max) {
      return { value: null, ok: false };
    }
    return { value: n, ok: true };
  };

  const hours = parseOptFloat(el.checkinSleepHours, 0, 24);
  const routineSteps = parseOptInt(el.checkinRoutineSteps, 100);
  const exerciseMinutes = parseOptInt(el.checkinExerciseMinutes, 600);

  if (!hours.ok || !routineSteps.ok || !exerciseMinutes.ok) return null;

  const bedTime = el.checkinBedTime.value || null;
  const wakeTime = el.checkinWakeTime.value || null;

  return {
    sleep: {
      bedTime,
      wakeTime,
      hours: hours.value,
      quality: Number(el.checkinSleepQuality.value),
    },
    relaxationRoutine: {
      done: el.checkinRoutineDone.checked,
      steps: el.checkinRoutineDone.checked ? routineSteps.value : null,
    },
    activity1: el.checkinActivity1.checked,
    operation1: el.checkinOperation1.checked,
    yesterdayQuality: Number(el.checkinYesterdayQuality.value),
    exercise: {
      done: el.checkinExerciseDone.checked,
      minutes: el.checkinExerciseDone.checked ? exerciseMinutes.value : null,
    },
  };
}

/* ------------------------------------------------------------
   Settings form
   ------------------------------------------------------------ */
export function populateSettingsForm() {
  const plan = state.doc.studyPlan;
  // Stored as Gregorian "YYYY-MM-DD"; <input type="date"> uses the same format.
  el.studyStartDate.value = plan.startDate || '';
  el.examDate.value = plan.examDate || '';
  el.totalWeeks.value = plan.totalWeeks || '';
  renderSubjectManageList();
}
/** Rebuilds the removable subject chips inside Settings → Subjects. */
export function renderSubjectManageList() {
  if (!el.subjectManageList) return;
  el.subjectManageList.replaceChildren();
  const subjects = Array.isArray(state.doc.subjects) ? state.doc.subjects : [];
  subjects.forEach((subject) => {
    const name = typeof subject === 'string' ? subject : subject?.name;
    if (!name) return;
    const chip = document.createElement('span');
    chip.className = 'subject-manage-chip';
    const label = document.createElement('span');
    label.className = 'subject-manage-chip__label';
    label.textContent = name;
    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'subject-manage-chip__remove';
    removeBtn.dataset.subject = name;
    removeBtn.setAttribute('aria-label', 'Remove');
    removeBtn.textContent = '×';
    chip.append(label, removeBtn);
    el.subjectManageList.appendChild(chip);
  });
}
export function openSettings() {
  const { settings, studyPlan } = state.doc;
  const dailyGoalMinutes = Number(studyPlan?.dailyGoalMinutes) || 240;
  const defaultSessionMinutes = Number(settings?.defaultSessionMinutes) || 50;
  el.settingGoalHours.value = dailyGoalMinutes / 60;
  el.settingDefaultMinutes.value = defaultSessionMinutes;
  el.settingSound.checked = Boolean(settings?.soundEnabled);
  el.settingClock24.checked = settings?.clockFormat === '24h';
  el.settingReducedMotion.checked = Boolean(settings?.reducedMotion);
  el.settingAutoStart.checked = Boolean(settings?.autoStartNextSession);
  populateSettingsForm();
  el.settingsModal.hidden = false;
  el.settingsModal.setAttribute('aria-hidden', 'false');
}
export function closeSettings() {
  el.settingsModal.hidden = true;
  el.settingsModal.setAttribute('aria-hidden', 'true');
}
function readPlanFromForm() {
  const totalWeeksRaw = Number(el.totalWeeks.value);
  return {
    startDate: el.studyStartDate.value || null,
    examDate: el.examDate.value || null,
    totalWeeks: Number.isFinite(totalWeeksRaw) && totalWeeksRaw > 0 ? Math.round(totalWeeksRaw) : 0,
  };
}
/** Returns an error code, or null when the plan is valid (an empty plan is valid = cleared). */
export function validatePlan(plan) {
  if (!plan.startDate && !plan.examDate && !plan.totalWeeks) return null;
  if (!plan.startDate || !plan.examDate) return 'missing';
  if (plan.examDate <= plan.startDate) return 'range';
  if (!Number.isInteger(plan.totalWeeks) || plan.totalWeeks <= 0) return 'weeks';
  return null;
}
/** Returns false when the exam plan is invalid (other settings are still saved). */
export function applySettingsFromForm({ showErrors = false } = {}) {
  const goalHours = clamp(Number(el.settingGoalHours.value) || 4, 0.5, 16);
  const defMinutes = clamp(Math.round(Number(el.settingDefaultMinutes.value) || 50), 1, 600);
  const plan = readPlanFromForm();
  const planError = validatePlan(plan);
  const previousDefault = Number(state.doc.settings.defaultSessionMinutes) || 50;
  mutateDocument('settings', (doc) => {
    Object.assign(doc.settings, {
      defaultSessionMinutes: defMinutes,
      soundEnabled: el.settingSound.checked,
      clockFormat: el.settingClock24.checked ? '24h' : '12h',
      reducedMotion: el.settingReducedMotion.checked,
      autoStartNextSession: el.settingAutoStart.checked,
    });
    doc.studyPlan.dailyGoalMinutes = Math.round(goalHours * 60);
    if (!planError) {
      doc.studyPlan.startDate = plan.startDate;
      doc.studyPlan.examDate = plan.examDate;
      doc.studyPlan.totalWeeks = plan.totalWeeks;
    }
  });
  applyReducedMotion();
  if (defMinutes !== previousDefault && state.session.state === 'idle') {
    setSelectedMinutes(defMinutes);
  }
  Render.all();
  if (planError && showErrors) {
    const t = tr();
    const messages = {
      missing: t.planErrMissing,
      range: t.planErrRange,
      weeks: t.planErrWeeks,
    };
    showToast(messages[planError] || t.planErrMissing, 'error');
    return false;
  }
  return true;
}
