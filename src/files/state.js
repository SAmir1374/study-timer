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
} from './dataLayer.js';

/* ------------------------------------------------------------
   i18n
   ------------------------------------------------------------ */

export const I18N = {
  en: {
    checkinTitle: 'Daily check-in',
    checkinSleepSection: "Last night's sleep",
    checkinBedTime: 'Bedtime',
    checkinWakeTime: 'Wake time',
    checkinSleepHours: 'How many hours did you sleep?',
    checkinSleepQuality: 'Sleep quality (1–10)',
    checkinRoutineSection: "Last night's relaxation routine",
    checkinRoutineDone: 'Did you do your relaxation routine?',
    checkinRoutineSteps: 'How many steps?',
    checkinActivitiesSection: "Today's activities",
    checkinActivity1: 'Did you do activity #1?',
    checkinOperation1: 'Did you do operation د۱?',
    checkinYesterdaySection: 'Yesterday',
    checkinYesterdayQuality: 'Was yesterday a good day? (1–10)',
    checkinExerciseDone: 'Did you exercise yesterday?',
    checkinExerciseMinutes: 'For how many minutes?',
    checkinSkip: 'Skip for now',
    checkinSave: 'Save',
    toastCheckinSaved: 'Check-in saved',
    daysStripTitle: 'Plan Calendar',
    daysStripPast: 'Past',
    daysStripToday: 'Today',
    daysStripFuture: 'Future',
    backupFolderTitle: 'DAILY BACKUP FOLDER',
    connectBackupFolder: 'Connect backup folder',
    backupHint: 'A new snapshot file is created automatically once per day while the app is open.',
    toastBackupConnected: 'Backup folder connected',
    toastBackupFailed: 'Daily backup failed',

    weeklyPlanTitle: 'Weekly Plan',
    weeklyPlanFile: 'WEEKLY PLAN FILE',
    settings: 'Settings',
    daysLeft: 'Days left',
    daysPassed: 'Days passed',
    study: 'Study',
    break: 'Break',
    start: 'Start',
    pause: 'Pause',
    resume: 'Resume',
    reset: 'Reset',

    kindStudy: 'Study',
    kindPractice: 'Practice',
    kindTest: 'Test',
    kindAnalysis: 'Test analysis',
    kindReview: 'Review',
    practiceShort: 'Practice',
    testShort: 'Test',
    analysisShort: 'Analysis',
    reviewShort: 'Review',

    analyzing: 'ANALYZING',
    reviewing: 'REVIEWING',
    analysisComplete: 'ANALYSIS COMPLETE',
    reviewComplete: 'REVIEW COMPLETE',
    analysisSessionLabel: 'TEST ANALYSIS',
    reviewSessionLabel: 'SPACED REVIEW',

    focusSession: 'FOCUS SESSION',
    reviewSessionLabel: 'TEST ANALYSIS',
    readyToFocus: 'READY TO FOCUS',
    timeRemaining: 'TIME REMAINING',
    elapsed: 'Elapsed',
    remaining: 'Remaining',
    studySession: 'Study Session',
    finish: 'Finish',
    startBreak: 'Start 5-min break',
    backToStudy: 'Back to study',
    duration: 'Duration',
    custom: 'Custom',
    minutes: 'min',
    studyWindow: 'Or set a study window',
    apply: 'Apply',
    startTime: 'Start',
    endTime: 'End',

    subject: 'Subject',
    noSubject: 'No subject',
    subjectsSectionTitle: 'SUBJECTS',
    addSubjectPlaceholder: 'New subject',
    add: 'Add',
    bySubjectToday: 'By subject',
    noSubjectDataToday: 'No subject data yet today.',

    sessionKind: 'Session type',
    kindStudy: 'Study',
    kindPractice: 'Practice test',
    kindReview: 'Test analysis',
    practiceShort: 'Test',
    reviewShort: 'Analysis',

    analysisModalTitle: 'Test analysis',
    analysisModalSubtitle: 'Enter the results for this session',
    topicModalTitle: 'Topic',
    topicModalSubtitle: 'Which topic did you cover in this session?',
    analysisTopic: 'Topic name',
    analysisTestCount: 'Number of questions',
    analysisCorrectPercent: 'Correct answers (%)',
    analysisErrorCount: 'Analyzed errors',
    analysisSave: 'Save',
    analysisSkip: 'Skip for now',
    toastAnalysisSaved: 'Analysis saved',

    today: 'Today',
    studyTime: 'Study time',
    sessions: 'Sessions',
    leftToGoal: 'Left to goal',
    goalMet: 'Goal met',
    dailyGoal: 'Daily goal',
    timeline: 'Timeline',
    noSessionsToday: 'No sessions yet today.',
    sessionHistory: 'Session history',
    finishedSessions: 'Your finished sessions will show up here.',

    examCountdown: 'EXAM COUNTDOWN',
    week: 'Week',
    days: 'days',
    day: 'day',
    daysLeftLabel: 'DAYS LEFT',
    setExamDates: 'Set your study start date and exam date in Settings to activate the countdown.',
    todayStatus: 'TODAY',
    thisWeek: 'This week',

    saveNotConnected: 'Not connected',
    saveSaved: 'Saved',
    saveSaving: 'Saving…',
    saveUnsaved: 'Unsaved changes',
    saveError: 'Save failed',
    savePermission: 'Click to reconnect file',
    saveUnsupported: 'Use Export / Import',
    language: 'Language',
    toggleTheme: 'Toggle theme',
    fullscreen: 'Fullscreen',
    openSettings: 'Open settings',
    closeSettings: 'Close settings',

    dailyGoalHours: 'Daily goal (hours)',
    defaultSessionLength: 'Default session length (min)',
    soundOnCompletion: 'Sound on completion',
    clock24: '24-hour clock',
    reducedAnimation: 'Reduced animation',
    autoStartNext: 'Auto-start next session',
    examPlan: 'EXAM PLAN',
    studyStartDate: 'Study start date',
    examDate: 'Exam date',
    totalWeeks: 'Total weeks',
    studyDataFile: 'STUDY DATA FILE',
    createConnectFile: 'Create / Connect file',
    openFile: 'Open file',
    saveNow: 'Save now',
    exportJson: 'Export JSON',
    importJson: 'Import JSON',
    saveClose: 'Save & close',
    clearSavedData: 'Clear all saved data',

    connectTitle: 'Your study data is not connected',
    connectBody: 'Connect a study data file to keep your progress safe across sessions.',
    continueWithoutFile: 'Continue without a file',
    createConnectFileCaps: 'Create / Connect File',
    openExistingFile: 'Open existing file',

    focusing: 'FOCUSING',
    onBreak: 'ON A BREAK',
    reviewing: 'ANALYZING',
    paused: 'PAUSED',
    sessionComplete: 'SESSION COMPLETE',
    breakComplete: 'BREAK COMPLETE',
    reviewComplete: 'ANALYSIS COMPLETE',
    done: 'DONE',

    toastFileCreated: 'Data file created and connected',
    toastFileLoaded: 'Data file loaded',
    toastImported: 'Data imported',
    toastExported: 'Data exported',
    toastInvalid: 'Invalid study data file',
    toastSaveFailed: 'Could not save the data file',
    toastNoFileApi: "This browser can't access files directly. Use Export / Import JSON instead.",
    toastNoFile: 'Connect a data file first',
    toastNoPermission: 'Permission to access the file was denied',
    toastReadFailed: 'Could not read the file',
    toastSaved: 'Saved',
    toastCleared: 'All data cleared',
    confirmReset: 'Reset will cancel the current session. Continue?',
    confirmReplace:
      'The data currently in the app will be replaced by the data from the file. Continue?',
    confirmClear:
      'This erases ALL study data (sessions, settings, plan) and overwrites the connected file. It cannot be undone. Consider using Export first. Continue?',
    planErrMissing: 'Enter both dates and the total weeks to save the plan.',
    planErrRange: 'The exam date must be after the study start date.',
    planErrWeeks: 'Total weeks must be greater than zero.',
  },

  fa: {
    checkinTitle: 'چک‌این روزانه',
    checkinSleepSection: 'خواب دیشب',
    checkinBedTime: 'ساعت خواب',
    checkinWakeTime: 'ساعت بیداری',
    checkinSleepHours: 'چند ساعت خوابیدی؟',
    checkinSleepQuality: 'کیفیت خواب (۱ تا ۱۰)',
    checkinRoutineSection: 'روتین آرامش‌بخش دیشب',
    checkinRoutineDone: 'روتین آرامش‌بخش را انجام دادی؟',
    checkinRoutineSteps: 'چند مرحله انجام دادی؟',
    checkinActivitiesSection: 'فعالیت‌های امروز',
    checkinActivity1: 'فعالیت شماره ۱ را انجام دادی؟',
    checkinOperation1: 'عملیات د۱ را انجام دادی؟',
    checkinYesterdaySection: 'دیروز',
    checkinYesterdayQuality: 'دیروز روز خوبی بود؟ (۱ تا ۱۰)',
    checkinExerciseDone: 'دیروز ورزش کردی؟',
    checkinExerciseMinutes: 'چند دقیقه؟',
    checkinSkip: 'فعلاً رد شو',
    checkinSave: 'ذخیره',
    toastCheckinSaved: 'چک‌این ثبت شد',
    daysStripTitle: 'روزشمار برنامه',
    daysStripPast: 'گذشته',
    daysStripToday: 'امروز',
    daysStripFuture: 'آینده',
    backupFolderTitle: 'پوشه بکاپ روزانه',
    connectBackupFolder: 'اتصال پوشه بکاپ',
    backupHint: 'تا وقتی برنامه باز است، هر روز یک فایل بکاپ جدید به‌طور خودکار ساخته می‌شود.',
    toastBackupConnected: 'پوشه بکاپ متصل شد',
    toastBackupFailed: 'بکاپ‌گیری روزانه ناموفق بود',

    kindStudy: 'مطالعه',
    kindPractice: 'تمرین',
    kindTest: 'تست',
    kindAnalysis: 'تحلیل تست',
    kindReview: 'مرور',
    practiceShort: 'تمرین',
    testShort: 'تستی',
    analysisShort: 'تحلیل',
    reviewShort: 'مرور',

    analyzing: 'در حال تحلیل',
    reviewing: 'در حال مرور',
    analysisComplete: 'تحلیل کامل شد',
    reviewComplete: 'مرور کامل شد',
    analysisSessionLabel: 'تحلیل تست',
    reviewSessionLabel: 'مرور فاصله‌ای',

    weeklyPlanTitle: 'برنامه هفتگی',
    weeklyPlanFile: 'فایل برنامه هفتگی',
    settings: 'تنظیمات',
    daysLeft: 'روز باقی‌مانده',
    daysPassed: 'روز گذشته',
    study: 'مطالعه',
    break: 'استراحت',
    start: 'شروع',
    pause: 'توقف',
    resume: 'ادامه',
    reset: 'ریست',

    focusSession: 'جلسه مطالعه',
    reviewSessionLabel: 'تحلیل تست',
    readyToFocus: 'آماده مطالعه',
    timeRemaining: 'زمان باقی‌مانده',
    elapsed: 'سپری‌شده',
    remaining: 'باقی‌مانده',
    studySession: 'جلسه مطالعه',
    finish: 'پایان',
    startBreak: 'شروع ۵ دقیقه استراحت',
    backToStudy: 'بازگشت به مطالعه',
    duration: 'مدت زمان',
    custom: 'سفارشی',
    minutes: 'دقیقه',
    studyWindow: 'یا بازه مطالعه را تعیین کنید',
    apply: 'اعمال',
    startTime: 'شروع',
    endTime: 'پایان',

    subject: 'درس',
    noSubject: 'بدون درس',
    subjectsSectionTitle: 'درس‌ها',
    addSubjectPlaceholder: 'نام درس جدید',
    add: 'افزودن',
    bySubjectToday: 'به تفکیک درس',
    noSubjectDataToday: 'هنوز داده‌ای برای امروز ثبت نشده.',

    sessionKind: 'نوع جلسه',
    kindStudy: 'مطالعه',
    kindPractice: 'تست‌زنی',
    kindReview: 'تحلیل تست',
    practiceShort: 'تستی',
    reviewShort: 'تحلیل',

    analysisModalTitle: 'تحلیل تست',
    analysisModalSubtitle: 'نتیجه‌ی این جلسه را وارد کنید',
    topicModalTitle: 'مبحث',
    topicModalSubtitle: 'این جلسه روی چه مبحثی بود؟',
    analysisTopic: 'اسم مبحث',
    analysisTestCount: 'تعداد تست',
    analysisCorrectPercent: 'درصد پاسخ صحیح',
    analysisErrorCount: 'تعداد خطاهای تحلیل‌شده',
    analysisSave: 'ذخیره',
    analysisSkip: 'فعلاً رد شو',
    toastAnalysisSaved: 'تحلیل ذخیره شد',

    today: 'امروز',
    studyTime: 'زمان مطالعه',
    sessions: 'جلسات',
    leftToGoal: 'باقی‌مانده تا هدف',
    goalMet: 'هدف محقق شد',
    dailyGoal: 'هدف روزانه',
    timeline: 'خط زمانی',
    noSessionsToday: 'هنوز جلسه‌ای برای امروز ثبت نشده است.',
    sessionHistory: 'تاریخچه جلسات',
    finishedSessions: 'جلسات تمام‌شده شما اینجا نمایش داده می‌شوند.',

    examCountdown: 'شمارش معکوس کنکور',
    week: 'هفته',
    days: 'روز',
    day: 'روز',
    daysLeftLabel: 'روز باقی‌مانده',
    setExamDates:
      'برای فعال شدن شمارش معکوس، تاریخ شروع مطالعه و تاریخ کنکور را در تنظیمات وارد کنید.',
    todayStatus: 'امروز',
    thisWeek: 'این هفته',

    saveNotConnected: 'متصل نیست',
    saveSaved: 'ذخیره شد',
    saveSaving: 'در حال ذخیره…',
    saveUnsaved: 'تغییرات ذخیره‌نشده',
    saveError: 'خطا در ذخیره',
    savePermission: 'برای اتصال دوباره کلیک کنید',
    saveUnsupported: 'از خروجی/ورودی استفاده کنید',
    language: 'زبان',
    toggleTheme: 'تغییر تم',
    fullscreen: 'تمام‌صفحه',
    openSettings: 'باز کردن تنظیمات',
    closeSettings: 'بستن تنظیمات',

    dailyGoalHours: 'هدف روزانه (ساعت)',
    defaultSessionLength: 'مدت پیش‌فرض جلسه (دقیقه)',
    soundOnCompletion: 'صدای پایان جلسه',
    clock24: 'ساعت ۲۴ ساعته',
    reducedAnimation: 'کاهش انیمیشن',
    autoStartNext: 'شروع خودکار جلسه بعدی',
    examPlan: 'برنامه کنکور',
    studyStartDate: 'تاریخ شروع مطالعه',
    examDate: 'تاریخ کنکور',
    totalWeeks: 'تعداد کل هفته‌ها',
    studyDataFile: 'فایل داده‌های مطالعه',
    createConnectFile: 'ایجاد / اتصال فایل',
    openFile: 'باز کردن فایل',
    saveNow: 'ذخیره اکنون',
    exportJson: 'خروجی JSON',
    importJson: 'ورود JSON',
    saveClose: 'ذخیره و بستن',
    clearSavedData: 'پاک کردن تمام داده‌های ذخیره‌شده',

    connectTitle: 'داده‌های مطالعه شما متصل نیست',
    connectBody: 'برای حفظ اطلاعات پیشرفت خود بین جلسات، یک فایل داده مطالعه متصل کنید.',
    continueWithoutFile: 'ادامه بدون فایل',
    createConnectFileCaps: 'ایجاد / اتصال فایل',
    openExistingFile: 'باز کردن فایل موجود',

    focusing: 'در حال مطالعه',
    onBreak: 'در حال استراحت',
    reviewing: 'در حال تحلیل',
    paused: 'متوقف',
    sessionComplete: 'جلسه کامل شد',
    breakComplete: 'استراحت کامل شد',
    reviewComplete: 'تحلیل کامل شد',
    done: 'تمام',

    toastFileCreated: 'فایل داده ایجاد و متصل شد',
    toastFileLoaded: 'فایل داده بارگذاری شد',
    toastImported: 'داده‌ها وارد شدند',
    toastExported: 'فایل خروجی ساخته شد',
    toastInvalid: 'فایل داده نامعتبر است (Invalid study data file)',
    toastSaveFailed: 'ذخیره فایل داده ناموفق بود',
    toastNoFileApi:
      'این مرورگر دسترسی مستقیم به فایل را پشتیبانی نمی‌کند. از خروجی/ورودی JSON استفاده کنید.',
    toastNoFile: 'ابتدا یک فایل داده متصل کنید',
    toastNoPermission: 'دسترسی به فایل داده نشد',
    toastReadFailed: 'خواندن فایل ناموفق بود',
    toastSaved: 'ذخیره شد',
    toastCleared: 'تمام داده‌ها پاک شد',
    confirmReset: 'ریست، جلسه فعلی را لغو می‌کند. ادامه می‌دهید؟',
    confirmReplace: 'داده‌های فعلی برنامه با داده‌های فایل جایگزین می‌شوند. ادامه می‌دهید؟',
    confirmClear:
      'تمام داده‌ها (جلسات، تنظیمات و برنامه) پاک می‌شوند و در صورت اتصال فایل، محتوای آن هم بازنویسی می‌شود. این کار قابل بازگشت نیست. پیش از این کار بهتر است Export بگیرید. ادامه می‌دهید؟',
    planErrMissing: 'برای ذخیره برنامه، هر دو تاریخ و تعداد هفته را وارد کنید.',
    planErrRange: 'تاریخ کنکور باید بعد از تاریخ شروع مطالعه باشد.',
    planErrWeeks: 'تعداد هفته‌ها باید بزرگ‌تر از صفر باشد.',
  },
};

/* ------------------------------------------------------------
   State
   ------------------------------------------------------------ */

export const state = {
  doc: createEmptyDocument(),
  summaries: {},
  session: {
    state: 'idle', // 'idle' | 'running' | 'paused' | 'complete'
    type: 'study', // 'study' | 'break' | 'review'
    subject: null, // string or null — meaningful while type is 'study' or 'review'
    isPractice: false, // false = regular study, true = practice test — only meaningful while type === 'study'
    durationMs: 50 * 60 * 1000,
    record: null, // the active session record inside state.doc.sessions
    finalElapsedMs: 0, // shown briefly in the 'complete' state
  },
  file: {
    supported: false,
    // 'unsupported' | 'disconnected' | 'permission' | 'saved' | 'saving' | 'unsaved' | 'error'
    status: 'disconnected',
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
      console.error('Data change listener failed:', err);
    }
  }
}

/* ------------------------------------------------------------
   Document access / mutation
   ------------------------------------------------------------ */
const KIND_VALUES = ['study', 'practice', 'test', 'analysis', 'review'];

export function getActiveRecord() {
  return state.session.record;
}

export function rebuildSummaries() {
  state.summaries = buildDailySummaries(state.doc.sessions);
}

/**
 * The kind picker has three mutually-exclusive positions: 'study',
 * 'practice' (practice test), 'review' (تحلیل تست و تمرین). This is what
 * the NEXT session will be if nothing else overrides it. Backed by
 * doc.settings.lastSelectedKind; lastSelectedPractice is kept in sync
 * (== 'practice') only for older code that still reads the boolean.
 */
export function getNextSessionKind() {
  const k = state.doc.settings.lastSelectedKind;
  return ['study', 'practice', 'test', 'analysis', 'review'].includes(k) ? k : 'study';
}

export function setSelectedKind(kind) {
  if (!KIND_VALUES.includes(kind)) return;

  mutateDocument('settings', (doc) => {
    doc.settings.lastSelectedKind = kind;
    doc.settings.lastSelectedPractice = kind === 'practice' || kind === 'test';
  });

  if (state.session.state === 'idle') {
    state.session.type = kind; // ← type دقیقاً همان kind است (study/practice/test/analysis/review)
    state.session.isPractice = kind === 'practice' || kind === 'test';
  }
}

/** Backward-compatible wrapper: true/false only distinguishes study vs practice. */
export function setSelectedPractice(isPractice) {
  setSelectedKind(isPractice ? 'practice' : 'study');
}

/** Backward-compatible wrapper some older code may still call. */
export function getNextSessionPractice() {
  const k = getNextSessionKind();
  return k === 'practice' || k === 'test';
}

/**
 * Kind to *display* in the kind picker / ring label: while a non-break
 * session is running/paused/complete it's that session's own kind;
 * otherwise (idle, or during a break) it's the selected next kind.
 */

export function getDisplayedKind() {
  const s = state.session;
  if (s.state !== 'idle' && s.type !== 'break') return s.type;
  return getNextSessionKind();
}

/** Backward-compatible wrapper: true only for the 'practice' kind. */
export function getDisplayedPractice() {
  const k = getDisplayedKind();
  return k === 'practice' || k === 'test';
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
    const kind = getNextSessionKind();
    s.state = 'idle';
    s.type = kind;
    s.subject = state.doc.settings.lastSelectedSubject;
    s.isPractice = kind === 'practice' || kind === 'test';
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
  mutateDocument('settings', (doc) => Object.assign(doc.settings, patch));
}

export function setSelectedMinutes(minutes) {
  mutateDocument('settings', (doc) => {
    doc.settings.lastSelectedMinutes = minutes;
  });
  if (state.session.state === 'idle') {
    state.session.durationMs = minutes * 60 * 1000;
  }
}

/** subject: a subject name from doc.subjects, or null for "no subject". Only affects the next study/review session. */
export function setSelectedSubject(subject) {
  mutateDocument('settings', (doc) => {
    doc.settings.lastSelectedSubject = subject;
  });
  if (state.session.state === 'idle') {
    state.session.subject = subject;
  }
}

/** Adds a subject to the manageable list (Settings → Subjects). Returns false if blank or already present. */
export function addSubject(name) {
  const trimmed = (name || '').trim();
  if (!trimmed) return false;
  let added = false;
  mutateDocument('subjects', (doc) => {
    if (!doc.subjects.some((s) => s.name === trimmed)) {
      doc.subjects.push({ name: trimmed });
      added = true;
    }
  });
  return added;
}

/** Removes a subject from the selectable list. Past sessions keep their recorded subject string regardless. */
export function removeSubject(name) {
  mutateDocument('subjects', (doc) => {
    doc.subjects = doc.subjects.filter((s) => s.name !== name);
    if (doc.settings.lastSelectedSubject === name) doc.settings.lastSelectedSubject = null;
  });
  if (state.session.state === 'idle' && state.session.subject === name) {
    state.session.subject = null;
  }
}

/**
 * Records which weekly-plans file is connected (or null). Pure metadata —
 * this never reads/writes weekly-plans.json itself; that's weeklyPlanStore.js's
 * job. Called by app.js after WeeklyPlanStore connects/creates/loads a file.
 */
export function setWeeklyPlanSource(name) {
  mutateDocument('studyPlan', (doc) => {
    doc.studyPlan.weeklyPlanSource = name || null;
  });
}

/* ------------------------------------------------------------
   Dates
   ------------------------------------------------------------ */

export function todayKey(ts = Date.now()) {
  return dateKeyOf(ts, currentUtcOffsetMinutes(ts));
}

function dayNumber(key) {
  const [y, m, d] = key.split('-').map(Number);
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

/** Find any session (finished or not) by id — used to attach analysis metrics after a review session ends. */
export function findSessionById(id) {
  return state.doc.sessions.find((rec) => rec.id === id) || null;
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
