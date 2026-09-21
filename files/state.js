/* =============================================================
   state.js  (Application State)

   UI  ->  state.js  ->  dataLayer.js  ->  JSON file (persistence.js)

   state.doc      the canonical JSON document (persisted)
   state.summaries derived, rebuilt from sessions (not persisted as source)
   state.session  runtime timer view (idle / running / paused / complete)
   state.file     runtime file-connection status (never written to JSON)
   ============================================================= */

import {
  buildDailySummaries,
  buildSubjectSummaries,
  createEmptyDocument,
  currentUtcOffsetMinutes,
  dateKeyOf,
  findActiveRecord,
  fromIso,
  isCountedSession,
  sessionDayKey,
} from "./dataLayer.js";

/* ------------------------------------------------------------
   i18n
   ------------------------------------------------------------ */

export const I18N = {
  en: {
    settings: "Settings",
    daysLeft: "Days left",
    daysPassed: "Days passed",
    study: "Study",
    break: "Break",
    start: "Start",
    pause: "Pause",
    resume: "Resume",
    reset: "Reset",

    focusSession: "FOCUS SESSION",
    readyToFocus: "READY TO FOCUS",
    timeRemaining: "TIME REMAINING",
    elapsed: "Elapsed",
    remaining: "Remaining",
    studySession: "Study Session",
    finish: "Finish",
    startBreak: "Start 5-min break",
    backToStudy: "Back to study",
    duration: "Duration",
    custom: "Custom",
    minutes: "min",
    studyWindow: "Or set a study window",
    apply: "Apply",
    startTime: "Start",
    endTime: "End",

    subject: "Subject",
    noSubject: "No subject",
    subjectsSectionTitle: "SUBJECTS",
    addSubjectPlaceholder: "New subject",
    add: "Add",
    bySubjectToday: "By subject",
    noSubjectDataToday: "No subject data yet today.",

    sessionKind: "Session type",
    kindStudy: "Study",
    kindPractice: "Practice test",
    practiceShort: "Test",

    today: "Today",
    studyTime: "Study time",
    sessions: "Sessions",
    leftToGoal: "Left to goal",
    goalMet: "Goal met",
    dailyGoal: "Daily goal",
    timeline: "Timeline",
    noSessionsToday: "No sessions yet today.",
    sessionHistory: "Session history",
    finishedSessions: "Your finished sessions will show up here.",

    examCountdown: "EXAM COUNTDOWN",
    week: "Week",
    days: "days",
    day: "day",
    daysLeftLabel: "DAYS LEFT",
    setExamDates: "Set your study start date and exam date in Settings to activate the countdown.",
    todayStatus: "TODAY",
    thisWeek: "This week",

    saveNotConnected: "Not connected",
    saveSaved: "Saved",
    saveSaving: "Saving…",
    saveUnsaved: "Unsaved changes",
    saveError: "Save failed",
    savePermission: "Click to reconnect file",
    saveUnsupported: "Use Export / Import",
    language: "Language",
    toggleTheme: "Toggle theme",
    fullscreen: "Fullscreen",
    openSettings: "Open settings",
    closeSettings: "Close settings",

    dailyGoalHours: "Daily goal (hours)",
    defaultSessionLength: "Default session length (min)",
    soundOnCompletion: "Sound on completion",
    clock24: "24-hour clock",
    reducedAnimation: "Reduced animation",
    autoStartNext: "Auto-start next session",
    examPlan: "EXAM PLAN",
    studyStartDate: "Study start date",
    examDate: "Exam date",
    totalWeeks: "Total weeks",
    studyDataFile: "STUDY DATA FILE",
    createConnectFile: "Create / Connect file",
    openFile: "Open file",
    saveNow: "Save now",
    exportJson: "Export JSON",
    importJson: "Import JSON",
    saveClose: "Save & close",
    clearSavedData: "Clear all saved data",

    connectTitle: "Your study data is not connected",
    connectBody: "Connect a study data file to keep your progress safe across sessions.",
    continueWithoutFile: "Continue without a file",
    createConnectFileCaps: "Create / Connect File",
    openExistingFile: "Open existing file",

    focusing: "FOCUSING",
    onBreak: "ON A BREAK",
    paused: "PAUSED",
    sessionComplete: "SESSION COMPLETE",
    breakComplete: "BREAK COMPLETE",
    done: "DONE",

    toastFileCreated: "Data file created and connected",
    toastFileLoaded: "Data file loaded",
    toastImported: "Data imported",
    toastExported: "Data exported",
    toastInvalid: "Invalid study data file",
    toastSaveFailed: "Could not save the data file",
    toastNoFileApi: "This browser can't access files directly. Use Export / Import JSON instead.",
    toastNoFile: "Connect a data file first",
    toastNoPermission: "Permission to access the file was denied",
    toastReadFailed: "Could not read the file",
    toastSaved: "Saved",
    toastCleared: "All data cleared",
    confirmReset: "Reset will cancel the current session. Continue?",
    confirmReplace: "The data currently in the app will be replaced by the data from the file. Continue?",
    confirmClear:
      "This erases ALL study data (sessions, settings, plan) and overwrites the connected file. It cannot be undone. Consider using Export first. Continue?",
    planErrMissing: "Enter both dates and the total weeks to save the plan.",
    planErrRange: "The exam date must be after the study start date.",
    planErrWeeks: "Total weeks must be greater than zero.",
  },

  fa: {
    settings: "تنظیمات",
    daysLeft: "روز باقی‌مانده",
    daysPassed: "روز گذشته",
    study: "مطالعه",
    break: "استراحت",
    start: "شروع",
    pause: "توقف",
    resume: "ادامه",
    reset: "ریست",

    focusSession: "جلسه مطالعه",
    readyToFocus: "آماده مطالعه",
    timeRemaining: "زمان باقی‌مانده",
    elapsed: "سپری‌شده",
    remaining: "باقی‌مانده",
    studySession: "جلسه مطالعه",
    finish: "پایان",
    startBreak: "شروع ۵ دقیقه استراحت",
    backToStudy: "بازگشت به مطالعه",
    duration: "مدت زمان",
    custom: "سفارشی",
    minutes: "دقیقه",
    studyWindow: "یا بازه مطالعه را تعیین کنید",
    apply: "اعمال",
    startTime: "شروع",
    endTime: "پایان",

    subject: "درس",
    noSubject: "بدون درس",
    subjectsSectionTitle: "درس‌ها",
    addSubjectPlaceholder: "نام درس جدید",
    add: "افزودن",
    bySubjectToday: "به تفکیک درس",
    noSubjectDataToday: "هنوز داده‌ای برای امروز ثبت نشده.",

    sessionKind: "نوع جلسه",
    kindStudy: "مطالعه",
    kindPractice: "تست‌زنی",
    practiceShort: "تستی",

    today: "امروز",
    studyTime: "زمان مطالعه",
    sessions: "جلسات",
    leftToGoal: "باقی‌مانده تا هدف",
    goalMet: "هدف محقق شد",
    dailyGoal: "هدف روزانه",
    timeline: "خط زمانی",
    noSessionsToday: "هنوز جلسه‌ای برای امروز ثبت نشده است.",
    sessionHistory: "تاریخچه جلسات",
    finishedSessions: "جلسات تمام‌شده شما اینجا نمایش داده می‌شوند.",

    examCountdown: "شمارش معکوس کنکور",
    week: "هفته",
    days: "روز",
    day: "روز",
    daysLeftLabel: "روز باقی‌مانده",
    setExamDates: "برای فعال شدن شمارش معکوس، تاریخ شروع مطالعه و تاریخ کنکور را در تنظیمات وارد کنید.",
    todayStatus: "امروز",
    thisWeek: "این هفته",

    saveNotConnected: "متصل نیست",
    saveSaved: "ذخیره شد",
    saveSaving: "در حال ذخیره…",
    saveUnsaved: "تغییرات ذخیره‌نشده",
    saveError: "خطا در ذخیره",
    savePermission: "برای اتصال دوباره کلیک کنید",
    saveUnsupported: "از خروجی/ورودی استفاده کنید",
    language: "زبان",
    toggleTheme: "تغییر تم",
    fullscreen: "تمام‌صفحه",
    openSettings: "باز کردن تنظیمات",
    closeSettings: "بستن تنظیمات",

    dailyGoalHours: "هدف روزانه (ساعت)",
    defaultSessionLength: "مدت پیش‌فرض جلسه (دقیقه)",
    soundOnCompletion: "صدای پایان جلسه",
    clock24: "ساعت ۲۴ ساعته",
    reducedAnimation: "کاهش انیمیشن",
    autoStartNext: "شروع خودکار جلسه بعدی",
    examPlan: "برنامه کنکور",
    studyStartDate: "تاریخ شروع مطالعه",
    examDate: "تاریخ کنکور",
    totalWeeks: "تعداد کل هفته‌ها",
    studyDataFile: "فایل داده‌های مطالعه",
    createConnectFile: "ایجاد / اتصال فایل",
    openFile: "باز کردن فایل",
    saveNow: "ذخیره اکنون",
    exportJson: "خروجی JSON",
    importJson: "ورود JSON",
    saveClose: "ذخیره و بستن",
    clearSavedData: "پاک کردن تمام داده‌های ذخیره‌شده",

    connectTitle: "داده‌های مطالعه شما متصل نیست",
    connectBody: "برای حفظ اطلاعات پیشرفت خود بین جلسات، یک فایل داده مطالعه متصل کنید.",
    continueWithoutFile: "ادامه بدون فایل",
    createConnectFileCaps: "ایجاد / اتصال فایل",
    openExistingFile: "باز کردن فایل موجود",

    focusing: "در حال مطالعه",
    onBreak: "در حال استراحت",
    paused: "متوقف",
    sessionComplete: "جلسه کامل شد",
    breakComplete: "استراحت کامل شد",
    done: "تمام",

    toastFileCreated: "فایل داده ایجاد و متصل شد",
    toastFileLoaded: "فایل داده بارگذاری شد",
    toastImported: "داده‌ها وارد شدند",
    toastExported: "فایل خروجی ساخته شد",
    toastInvalid: "فایل داده نامعتبر است (Invalid study data file)",
    toastSaveFailed: "ذخیره فایل داده ناموفق بود",
    toastNoFileApi: "این مرورگر دسترسی مستقیم به فایل را پشتیبانی نمی‌کند. از خروجی/ورودی JSON استفاده کنید.",
    toastNoFile: "ابتدا یک فایل داده متصل کنید",
    toastNoPermission: "دسترسی به فایل داده نشد",
    toastReadFailed: "خواندن فایل ناموفق بود",
    toastSaved: "ذخیره شد",
    toastCleared: "تمام داده‌ها پاک شد",
    confirmReset: "ریست، جلسه فعلی را لغو می‌کند. ادامه می‌دهید؟",
    confirmReplace: "داده‌های فعلی برنامه با داده‌های فایل جایگزین می‌شوند. ادامه می‌دهید؟",
    confirmClear:
      "تمام داده‌ها (جلسات، تنظیمات و برنامه) پاک می‌شوند و در صورت اتصال فایل، محتوای آن هم بازنویسی می‌شود. این کار قابل بازگشت نیست. پیش از این کار بهتر است Export بگیرید. ادامه می‌دهید؟",
    planErrMissing: "برای ذخیره برنامه، هر دو تاریخ و تعداد هفته را وارد کنید.",
    planErrRange: "تاریخ کنکور باید بعد از تاریخ شروع مطالعه باشد.",
    planErrWeeks: "تعداد هفته‌ها باید بزرگ‌تر از صفر باشد.",
  },
};

/* ------------------------------------------------------------
   State
   ------------------------------------------------------------ */

export const state = {
  doc: createEmptyDocument(),
  summaries: {},
  session: {
    state: "idle", // 'idle' | 'running' | 'paused' | 'complete'
    type: "study", // 'study' | 'break'
    subject: null, // string or null — only meaningful while type === 'study'
    isPractice: false, // false = regular study, true = practice test — only meaningful while type === 'study'
    durationMs: 50 * 60 * 1000,
    record: null, // the active session record inside state.doc.sessions
    finalElapsedMs: 0, // shown briefly in the 'complete' state
  },
  file: {
    supported: false,
    // 'unsupported' | 'disconnected' | 'permission' | 'saved' | 'saving' | 'unsaved' | 'error'
    status: "disconnected",
    name: null,
    lastSavedAt: null,
    dirty: false,
    error: null,
  },
  rev: 0, // increments on every committed change
};

export function tr() {
  return I18N[state.doc.settings.language] || I18N.en;
}

/* ------------------------------------------------------------
   Change notification (persistence.js subscribes to this)
   ------------------------------------------------------------ */

const listeners = new Set();

export function onDataChange(fn) {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

/** Call after any change to state.doc. immediate=true saves without debounce. */
export function commit(reason, { immediate = false } = {}) {
  state.rev += 1;
  for (const fn of listeners) {
    try {
      fn(reason, immediate);
    } catch (err) {
      console.error("Data change listener failed:", err);
    }
  }
}

/* ------------------------------------------------------------
   Document access / mutation
   ------------------------------------------------------------ */

export function getActiveRecord() {
  return state.session.record;
}

export function rebuildSummaries() {
  state.summaries = buildDailySummaries(state.doc.sessions);
}

export function syncSessionFromDocument() {
  const s = state.session;
  const rec = findActiveRecord(state.doc.sessions);
  if (rec) {
    s.state = rec.status;
    s.type = rec.type;
    s.subject = rec.subject;
    s.isPractice = !!rec.isPractice;
    s.durationMs = rec.planned.durationSeconds * 1000;
    s.record = rec;
  } else {
    s.state = "idle";
    s.type = "study";
    s.subject = state.doc.settings.lastSelectedSubject;
    s.isPractice = !!state.doc.settings.lastSelectedPractice;
    s.durationMs = state.doc.settings.lastSelectedMinutes * 60 * 1000;
    s.record = null;
  }
  s.finalElapsedMs = 0;
}

/** Replace the whole document (file load / import / clear). Does not commit. */
export function replaceDocument(doc) {
  state.doc = doc;
  rebuildSummaries();
  syncSessionFromDocument();
}

export function mutateDocument(reason, fn, opts) {
  fn(state.doc);
  commit(reason, opts);
}

export function updateSettings(patch) {
  mutateDocument("settings", (doc) => Object.assign(doc.settings, patch));
}

export function setSelectedMinutes(minutes) {
  mutateDocument("settings", (doc) => {
    doc.settings.lastSelectedMinutes = minutes;
  });
  if (state.session.state === "idle") {
    state.session.durationMs = minutes * 60 * 1000;
  }
}

/** subject: a subject name from doc.subjects, or null for "no subject". Only affects the next study session. */
export function setSelectedSubject(subject) {
  mutateDocument("settings", (doc) => {
    doc.settings.lastSelectedSubject = subject;
  });
  if (state.session.state === "idle") {
    state.session.subject = subject;
  }
}

/** isPractice: false = regular study, true = practice test. Only affects the next study session. */
export function setSelectedPractice(isPractice) {
  const value = !!isPractice;
  mutateDocument("settings", (doc) => {
    doc.settings.lastSelectedPractice = value;
  });
  if (state.session.state === "idle") {
    state.session.isPractice = value;
  }
}

/**
 * The kind the NEXT study session will have. The single source of truth is
 * doc.settings.lastSelectedPractice (persisted), never the runtime
 * state.session copy — so nothing that rebuilds/resets state.session
 * (recover, reset, sync...) can silently flip the choice back to "study".
 * TimerEngine.start() must read this when it creates the record.
 */
export function getNextSessionPractice() {
  return !!state.doc.settings.lastSelectedPractice;
}

/**
 * Kind to *display*: while a study session is running/paused/complete it is that
 * session's own kind; otherwise (idle, or during a break) it is the selected kind.
 */
export function getDisplayedPractice() {
  const s = state.session;
  if (s.state !== "idle" && s.type === "study") {
    return !!(s.record ? s.record.isPractice : s.isPractice);
  }
  return getNextSessionPractice();
}

/** Adds a subject to the manageable list (Settings → Subjects). Returns false if blank or already present. */
export function addSubject(name) {
  const trimmed = (name || "").trim();
  if (!trimmed) return false;
  let added = false;
  mutateDocument("subjects", (doc) => {
    if (!doc.subjects.some((s) => s.name === trimmed)) {
      doc.subjects.push({ name: trimmed });
      added = true;
    }
  });
  return added;
}

/** Removes a subject from the selectable list. Past sessions keep their recorded subject string regardless. */
export function removeSubject(name) {
  mutateDocument("subjects", (doc) => {
    doc.subjects = doc.subjects.filter((s) => s.name !== name);
    if (doc.settings.lastSelectedSubject === name) doc.settings.lastSelectedSubject = null;
  });
  if (state.session.state === "idle" && state.session.subject === name) {
    state.session.subject = null;
  }
}

/* ------------------------------------------------------------
   Dates
   ------------------------------------------------------------ */

export function todayKey(ts = Date.now()) {
  return dateKeyOf(ts, currentUtcOffsetMinutes(ts));
}

function dayNumber(key) {
  const [y, m, d] = key.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 86400000;
}

export function daysBetween(fromKey, toKey) {
  return Math.round(dayNumber(toKey) - dayNumber(fromKey));
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/* ------------------------------------------------------------
   Derived views (read-only)
   ------------------------------------------------------------ */

export function getTodaySummary() {
  return (
    state.summaries[todayKey()] || {
      studySeconds: 0,
      sessionCount: 0,
      completedSessionCount: 0,
    }
  );
}

/** Today's study time broken down by (subject, kind), sorted by time desc. Sessions with no subject are skipped. */
export function getTodaySubjectBreakdown() {
  return buildSubjectSummaries(state.doc.sessions, { dayKey: todayKey() });
}

/** Counted (finished) sessions that started on the given local day. */
export function getDaySessions(dayKey) {
  return state.doc.sessions
    .filter((rec) => isCountedSession(rec) && sessionDayKey(rec) === dayKey)
    .sort((a, b) => fromIso(a.actual.startedAt) - fromIso(b.actual.startedAt));
}

export function getExamProgress() {
  const { startDate, examDate, totalWeeks } = state.doc.studyPlan;
  if (!startDate || !examDate || !totalWeeks) return null;

  const today = todayKey();
  const totalDays = daysBetween(startDate, examDate);
  const daysPassed = clamp(daysBetween(startDate, today), 0, totalDays);
  const daysLeft = Math.max(0, daysBetween(today, examDate));
  const currentWeek = Math.min(totalWeeks, Math.max(1, Math.ceil((daysPassed + 1) / 7)));
  const progressPercent = totalDays > 0 ? Math.round((daysPassed / totalDays) * 100) : 0;

  return { totalDays, daysPassed, daysLeft, currentWeek, totalWeeks, progressPercent };
}

syncSessionFromDocument();
