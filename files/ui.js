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
  getDisplayedPractice,
  mutateDocument,
  updateSettings,
  setSelectedMinutes,
} from './state.js';
import { WeeklyPlanStore } from './weeklyPlanStore.js';
import { findPlanForDate, getSortedPlanDays } from './weeklyPlanData.js';

import { TimerEngine, fmtHMS, fmtMS, fmtHoursMinutes, fmtClock } from './timer.js';
import { fromIso, sessionDayKey } from './dataLayer.js';

const $ = (id) => document.getElementById(id);

export const el = {
  body: document.body,

  weeklyPlanMeta: $('weeklyPlanMeta'),
  weeklyPlanWeekLabel: $('weeklyPlanWeekLabel'),
  weeklyPlanGoal: $('weeklyPlanGoal'),
  weeklyPlanDays: $('weeklyPlanDays'),
  weeklyPlanEmpty: $('weeklyPlanEmpty'),

  weeklyPlanConnectFileBtn: $('weeklyPlanConnectFileBtn'),
  weeklyPlanOpenFileBtn: $('weeklyPlanOpenFileBtn'),
  weeklyPlanSaveNowBtn: $('weeklyPlanSaveNowBtn'),
  weeklyPlanExportBtn: $('weeklyPlanExportBtn'),
  weeklyPlanImportFileInput: $('weeklyPlanImportFileInput'),

  dailyStatusValue: $('dailyStatusValue'),
  weeklyStatusValue: $('weeklyStatusValue'),

  liveClock: $('liveClock'),
  liveDate: $('liveDate'),
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
  calendar: $('calendar'),
};

/* ------------------------------------------------------------
   Render
   ------------------------------------------------------------ */

function dateLocale() {
  return state.doc.settings.language === 'fa' ? 'fa-IR-u-ca-persian' : 'en-US';
}

function getActualMinutesForSubjectOnDate(dateKey, subject, isPractice) {
  const sessions = Array.isArray(state.sessions) ? state.sessions : [];

  return sessions.reduce((total, session) => {
    if (!session?.actual?.startedAt) return total;
    if (session.subject !== subject) return total;
    if (Boolean(session.isPractice) !== Boolean(isPractice)) return total;
    if (sessionDayKey(session) !== dateKey) return total;

    const seconds = Number(session?.derived?.activeDurationSeconds) || 0;
    return total + seconds / 60;
  }, 0);
}

function getSessionStatus(session, actualMinutes, dayDate, today) {
  const plannedMinutes = Number(session.minutes) || 0;
  const progress = plannedMinutes ? Math.min(100, (actualMinutes / plannedMinutes) * 100) : 0;

  if (dayDate > today) {
    return { plannedMinutes, actualMinutes, progress: 0, status: 'future' };
  }

  if (dayDate === today) {
    return { plannedMinutes, actualMinutes, progress, status: 'today' };
  }

  if (progress >= 100) return { plannedMinutes, actualMinutes, progress: 100, status: 'complete' };
  if (actualMinutes > 0) return { plannedMinutes, actualMinutes, progress, status: 'partial' };
  return { plannedMinutes, actualMinutes, progress: 0, status: 'missed' };
}

/** Per-session progress (matched by subject + practice flag), plus a day-level
    rollup derived from those sessions — used for the day's ✓/container class. */
function getWeeklyPlanDayStatus(day, today) {
  const rawSessions = Array.isArray(day.sessions) ? day.sessions : [];

  const sessions = rawSessions.map((session) => {
    const actualMinutes = getActualMinutesForSubjectOnDate(
      day.date,
      session.subject,
      session.practice
    );
    return { ...session, ...getSessionStatus(session, actualMinutes, day.date, today) };
  });

  const plannedMinutes = sessions.reduce((t, s) => t + s.plannedMinutes, 0);
  const actualMinutes = sessions.reduce((t, s) => t + s.actualMinutes, 0);

  let status;
  if (day.date > today) status = 'future';
  else if (day.date === today) status = 'today';
  else if (sessions.length && sessions.every((s) => s.status === 'complete')) status = 'complete';
  else if (sessions.some((s) => s.actualMinutes > 0)) status = 'partial';
  else status = 'missed';

  return {
    status,
    plannedMinutes,
    actualMinutes,
    progress: plannedMinutes ? Math.min(100, (actualMinutes / plannedMinutes) * 100) : 0,
    sessions,
  };
}

export const Render = {
  _lastText: new WeakMap(),

  setText(node, value) {
    if (!node) return;
    if (this._lastText.get(node) === value) return;
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
      new Date(now).toLocaleDateString(dateLocale(), { month: 'short', day: 'numeric' })
    );
  },

  statusText() {
    const s = state.session;
    const t = tr();
    if (s.state === 'running') return s.type === 'study' ? t.focusing : t.onBreak;
    if (s.state === 'paused') return t.paused;
    if (s.state === 'complete') return s.type === 'study' ? t.sessionComplete : t.breakComplete;
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

    this.setText(el.modeLabel, s.type === 'break' ? t.break : t.focusSession);
    this.setText(el.statusLabel, this.statusText());
    this.setText(el.timeDisplay, fmtHMS(remaining));
    this.setText(el.timeCaption, s.state === 'complete' ? t.done : t.timeRemaining);
    this.setText(el.elapsedValue, fmtMS(elapsed));
    this.setText(el.remainingValue, fmtMS(remaining));

    if (el.ringSubject) {
      // "Subject · Practice test" — the kind is shown even when no subject is picked.
      const parts = [];
      if (s.type === 'study') {
        if (s.subject) parts.push(s.subject);
        if (getDisplayedPractice()) parts.push(t.kindPractice);
      }
      el.ringSubject.hidden = parts.length === 0;
      this.setText(el.ringSubject, parts.join(' · '));
    }

    const pct = Math.round(fraction * 100);
    this.setText(el.progressLabel, s.type === 'break' ? t.break : t.studySession);
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

    const goalSeconds = state.doc.studyPlan.dailyGoalMinutes * 60;
    const remainingGoal = Math.max(0, goalSeconds - totalSeconds);
    this.setText(
      el.todayRemainingGoal,
      remainingGoal === 0 ? t.goalMet : fmtHoursMinutes(remainingGoal)
    );

    const goalPct = goalSeconds > 0 ? Math.round(Math.min(1, totalSeconds / goalSeconds) * 100) : 0;
    el.goalProgressFill.style.width = goalPct + '%';
  },

  /** Today's per-(subject, kind) totals. The same subject can appear twice:
      once for regular study and once for practice tests. */
  todaySubjects() {
    if (!el.subjectBreakdown) return;
    const t = tr();
    const items = getTodaySubjectBreakdown();
    el.subjectBreakdown.querySelectorAll('.subject-breakdown-item').forEach((n) => n.remove());

    if (!items.length) {
      el.subjectBreakdownEmpty.hidden = false;
      return;
    }
    el.subjectBreakdownEmpty.hidden = true;

    items.forEach((item) => {
      const row = document.createElement('div');
      row.className =
        'subject-breakdown-item' + (item.isPractice ? ' subject-breakdown-item--practice' : '');

      const label = document.createElement('span');
      label.className = 'subject-breakdown-item__label';
      label.textContent = item.isPractice ? `${item.subject} · ${t.practiceShort}` : item.subject;

      const value = document.createElement('span');
      value.className = 'subject-breakdown-item__value';
      value.textContent = fmtHoursMinutes(item.studySeconds);

      row.appendChild(label);
      row.appendChild(value);
      el.subjectBreakdown.appendChild(row);
    });
  },

  timeline() {
    const t = tr();
    const items = getDaySessions(todayKey());
    el.timeline.querySelectorAll('.timeline-item').forEach((n) => n.remove());

    if (!items.length) {
      el.timelineEmpty.hidden = false;
      return;
    }
    el.timelineEmpty.hidden = true;

    const maxDur = Math.max(...items.map((r) => r.derived.activeDurationSeconds), 1);
    items.forEach((rec) => {
      const row = document.createElement('div');
      row.className = 'timeline-item';

      if (rec.type === 'study') {
        const parts = [];
        if (rec.subject) parts.push(rec.subject);
        if (rec.isPractice) parts.push(t.kindPractice);
        row.title = parts.join(' · ');
      } else {
        row.title = '';
      }

      const bar = document.createElement('span');
      bar.className =
        'timeline-item__bar' +
        (rec.type === 'break' ? ' timeline-item__bar--break' : '') +
        (rec.type === 'study' && rec.isPractice ? ' timeline-item__bar--practice' : '');
      bar.style.flexGrow = String(Math.max(0.15, rec.derived.activeDurationSeconds / maxDur));
      bar.style.flexBasis = '0';

      const label = document.createElement('span');
      label.className = 'timeline-item__label';
      label.textContent = `${fmtClock(fromIso(rec.actual.startedAt))}–${fmtClock(fromIso(rec.actual.endedAt))}`;

      row.appendChild(bar);
      row.appendChild(label);
      el.timeline.appendChild(row);
    });
  },

  history() {
    const items = getDaySessions(todayKey()).reverse();
    el.historyList.querySelectorAll('.history-item').forEach((n) => n.remove());

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
      left.textContent = `${fmtClock(fromIso(rec.actual.startedAt))} – ${fmtClock(fromIso(rec.actual.endedAt))}`;

      if (rec.type === 'break') {
        const tag = document.createElement('span');
        tag.className = 'history-item__type';
        tag.textContent = tr().break;
        left.appendChild(tag);
      } else {
        if (rec.subject) {
          const tag = document.createElement('span');
          tag.className = 'history-item__subject';
          tag.textContent = rec.subject;
          left.appendChild(tag);
        }
        if (rec.isPractice) {
          const tag = document.createElement('span');
          tag.className = 'history-item__practice';
          tag.textContent = tr().practiceShort;
          left.appendChild(tag);
        }
      }

      const right = document.createElement('span');
      right.className = 'history-item__duration';
      right.textContent = fmtHoursMinutes(rec.derived.activeDurationSeconds);

      row.appendChild(left);
      row.appendChild(right);
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

  /** Rebuilds the subject chip picker from doc.subjects (variable-length list, unlike the fixed duration presets). */
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
    state.doc.subjects.forEach((s) => el.subjectGrid.appendChild(makeChip(s.name, s.name)));
  },

  /** Study / Practice-test switch. Highlights the kind of the next (or current) study session. */
  kind() {
    if (!el.kindGrid) return;
    const practice = getDisplayedPractice();
    el.kindGrid.querySelectorAll('.kind-btn').forEach((btn) => {
      btn.classList.toggle('is-active', (btn.dataset.kind === 'practice') === practice);
    });
  },

  /** Shows the current ISO week's plan (if a weekly-plans file is connected
      and has one), by reading WeeklyPlanStore directly — no local state
      duplication of the plan data. */

  weeklyPlan() {
    const language = state.language || 'fa';
    const container = el.weeklyPlanDays;
    const meta = el.weeklyPlanMeta;
    const weekLabel = el.weeklyPlanWeekLabel;
    const goal = el.weeklyPlanGoal;
    const empty = el.weeklyPlanEmpty;

    if (!container) return;

    container.innerHTML = '';

    if (!WeeklyPlanStore.isConnected()) {
      if (meta) meta.hidden = true;

      if (empty) {
        empty.hidden = false;
        empty.textContent =
          language === 'fa'
            ? 'برای مشاهده برنامه این هفته، فایل برنامه هفتگی را از تنظیمات متصل کنید.'
            : "Connect a weekly plan file in Settings to see this week's plan.";
      }

      return;
    }

    const plan = findPlanForDate(WeeklyPlanStore.getPlans(), todayKey());

    if (!plan) {
      if (meta) meta.hidden = true;

      if (empty) {
        empty.hidden = false;
        empty.textContent =
          language === 'fa' ? 'برای این هفته برنامه‌ای وجود ندارد.' : 'No plan for this week.';
      }

      return;
    }

    if (empty) empty.hidden = true;
    if (meta) meta.hidden = false;

    if (weekLabel) {
      weekLabel.textContent =
        language === 'fa'
          ? `${plan.title || 'برنامه هفتگی'} • ${plan.weekStart} تا ${plan.weekEnd}`
          : `${plan.title || 'Weekly Plan'} • ${plan.weekStart} – ${plan.weekEnd}`;
    }

    if (goal) {
      goal.textContent =
        language === 'fa' ? `هدف ${plan.targetMinutes} دقیقه` : `${plan.targetMinutes} min goal`;
    }

    const days = getSortedPlanDays(plan);
    const today = todayKey();

    days.forEach((day) => {
      const dayStatus = getWeeklyPlanDayStatus(day, today);
      const dayElement = document.createElement('div');
      dayElement.className = `weekly-plan-day is-${dayStatus.status}`;

      const sessionProgressLabel = (session) => {
        if (session.status === 'complete') return language === 'fa' ? 'کامل انجام شد' : 'Completed';
        if (session.status === 'partial') {
          return language === 'fa'
            ? `${Math.round(session.progress)}٪ انجام شد`
            : `${Math.round(session.progress)}% completed`;
        }
        if (session.status === 'today') {
          return language === 'fa'
            ? `${Math.round(session.progress)}٪ تا الان`
            : `${Math.round(session.progress)}% so far`;
        }
        if (session.status === 'missed') return language === 'fa' ? 'انجام نشده' : 'Not completed';
        return ''; // 'future'
      };

      const sessionMarkup = dayStatus.sessions.length
        ? dayStatus.sessions
            .map((session) => {
              const typeLabel =
                {
                  study: language === 'fa' ? 'مطالعه' : 'Study',
                  practice: language === 'fa' ? 'تست' : 'Practice',
                  review: language === 'fa' ? 'مرور' : 'Review',
                  test: language === 'fa' ? 'آزمون' : 'Test',
                }[session.type] || session.type;

              const showBar = session.status !== 'future';

              return `
              <div class="weekly-plan-session is-${session.status}">
                <div class="weekly-plan-session__main">
                  <span class="weekly-plan-session__subject">
                    ${session.subject}
                  </span>

                  <span class="weekly-plan-session__type">
                    ${typeLabel}
                  </span>
                </div>

                <span class="weekly-plan-session__minutes">
                  ${session.minutes} ${language === 'fa' ? 'دقیقه' : 'min'}
                </span>

                ${
                  showBar
                    ? `
                <div class="weekly-plan-progress weekly-plan-progress--session">
                  <div class="weekly-plan-progress__bar">
                    <span style="width: ${session.progress}%"></span>
                  </div>
                  <div class="weekly-plan-progress__label">
                    ${sessionProgressLabel(session)}
                  </div>
                </div>
                `
                    : ''
                }
              </div>
            `;
            })
            .join('')
        : `
          <div class="weekly-plan-no-session">
            ${language === 'fa' ? 'برنامه‌ای ثبت نشده' : 'No sessions planned'}
          </div>
        `;

      dayElement.innerHTML = `
      <div class="weekly-plan-day__header">
        <div class="weekly-plan-day__identity">
          <div class="weekly-plan-day__title">
            ${
              dayStatus.status === 'complete' ? '<span class="weekly-plan-day__check">✓</span>' : ''
            }

            ${day.title || day.date}
          </div>

          <div class="weekly-plan-day__date">
            ${day.date}
          </div>
        </div>

        <div class="weekly-plan-day__total">
          <strong>${dayStatus.plannedMinutes}</strong>
          <span>${language === 'fa' ? 'دقیقه' : 'min'}</span>
        </div>
      </div>

      <div class="weekly-plan-sessions">
        ${sessionMarkup}
      </div>

      ${day.note ? `<div class="weekly-plan-day__note">${day.note}</div>` : ''}
    `;

      container.appendChild(dayElement);
    });
  },

  exam() {
    const progress = getExamProgress();

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
    if (f.name && ['saved', 'saving', 'unsaved'].includes(f.status)) text += ` · ${f.name}`;

    el.saveStatus.dataset.status = f.status;
    el.saveStatus.title = f.error || '';
    this.setText(el.saveStatusText, text);
  },

  calendar() {
    if (!el.calendar) return;

    el.calendar.innerHTML = '';
    const today = new Date();
    const day = today.getDay();
    const monday = new Date(today);
    monday.setDate(today.getDate() - ((day + 6) % 7));

    for (let i = 0; i < 7; i++) {
      const d = new Date(monday);
      d.setDate(monday.getDate() + i);
      const item = document.createElement('div');
      item.className = 'calendar-day';
      item.textContent = d.toLocaleDateString(dateLocale(), {
        weekday: 'short',
        day: 'numeric',
      });
      el.calendar.appendChild(item);
    }
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
    this.calendar();
    this.weeklyPlan();
  },
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
  Render.resetCache(); // textContent was written directly, so drop the cache
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
  return !el.settingsModal.hidden;
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
  el.subjectManageList.innerHTML = '';

  state.doc.subjects.forEach((s) => {
    const chip = document.createElement('span');
    chip.className = 'subject-manage-chip';

    const label = document.createElement('span');
    label.className = 'subject-manage-chip__label';
    label.textContent = s.name;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'subject-manage-chip__remove';
    removeBtn.dataset.subject = s.name;
    removeBtn.setAttribute('aria-label', 'Remove');
    removeBtn.textContent = '×';

    chip.appendChild(label);
    chip.appendChild(removeBtn);
    el.subjectManageList.appendChild(chip);
  });
}

export function openSettings() {
  const { settings, studyPlan } = state.doc;
  el.settingGoalHours.value = studyPlan.dailyGoalMinutes / 60;
  el.settingDefaultMinutes.value = settings.defaultSessionMinutes;
  el.settingSound.checked = settings.soundEnabled;
  el.settingClock24.checked = settings.clockFormat === '24h';
  el.settingReducedMotion.checked = settings.reducedMotion;
  el.settingAutoStart.checked = settings.autoStartNextSession;
  populateSettingsForm();

  el.settingsModal.hidden = false;
  el.settingsModal.setAttribute('aria-hidden', 'false');
}

export function closeSettings() {
  el.settingsModal.hidden = true;
  el.settingsModal.setAttribute('aria-hidden', 'true');
}

function readPlanFromForm() {
  return {
    startDate: el.studyStartDate.value || null, // "YYYY-MM-DD" or null
    examDate: el.examDate.value || null,
    totalWeeks: Math.round(Number(el.totalWeeks.value)) || 0,
  };
}

/** Returns an error code, or null when the plan is valid (an empty plan is valid = cleared). */
export function validatePlan(plan) {
  if (!plan.startDate && !plan.examDate && !plan.totalWeeks) return null;
  if (!plan.startDate || !plan.examDate) return 'missing';
  if (plan.examDate <= plan.startDate) return 'range';
  if (plan.totalWeeks <= 0) return 'weeks';
  return null;
}

/** Returns false when the exam plan is invalid (other settings are still saved). */
export function applySettingsFromForm({ showErrors = false } = {}) {
  const goalHours = clamp(Number(el.settingGoalHours.value) || 4, 0.5, 16);
  const defMinutes = clamp(Math.round(Number(el.settingDefaultMinutes.value) || 50), 1, 600);

  const plan = readPlanFromForm();
  const planError = validatePlan(plan);
  const previousDefault = state.doc.settings.defaultSessionMinutes;

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

  // Changing the default length also selects it (only when idle).
  if (defMinutes !== previousDefault && state.session.state === 'idle') {
    setSelectedMinutes(defMinutes);
  }

  Render.all();

  if (planError && showErrors) {
    const t = tr();
    const msg = { missing: t.planErrMissing, range: t.planErrRange, weeks: t.planErrWeeks }[
      planError
    ];
    showToast(msg, 'error');
    return false;
  }
  return true;
}
