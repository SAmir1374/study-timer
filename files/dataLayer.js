/* =============================================================
   dataLayer.js

   Pure data model for study-data.json.
   - No DOM, no storage, no UI knowledge.
   - Timestamps: ISO 8601 UTC ("2026-09-18T12:45:30.123Z").
   - Calendar dates (exam date, day keys): Gregorian "YYYY-MM-DD".
     Jalali is presentation only and never stored.
   - Raw data (sessions) is the source of truth.
     Everything under `derived` / `sessions[].derived` can be rebuilt.
   ============================================================= */

export const SCHEMA_VERSION = 1;
export const DATA_FORMAT = 'study-timer-json';
export const APP_NAME = 'Study Timer';
export const DEFAULT_FILE_NAME = 'study-data.json';
export const INVALID_FILE_MESSAGE = 'Invalid study data file';

export const SESSION_TYPES = Object.freeze(['study', 'break']);
export const SESSION_STATUSES = Object.freeze([
  'running',
  'paused',
  'completed', // reached planned duration
  'abandoned', // finished early by the user
  'cancelled', // reset by the user
]);
export const ACTIVE_STATUSES = Object.freeze(['running', 'paused']);

/** Sessions shorter than this are kept as raw data but not counted in UI stats. */
export const MIN_COUNTED_SECONDS = 5;

const MAX_SESSION_SECONDS = 24 * 60 * 60;
const MAX_ERRORS = 25;
const MAX_SUBJECT_LENGTH = 60;
const MAX_SUBJECTS = 60;

export class DataError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = 'DataError';
    this.details = details;
  }
}

/* ------------------------------------------------------------
   Defaults
   ------------------------------------------------------------ */

export const DEFAULT_SETTINGS = Object.freeze({
  language: 'en', // "fa" | "en"
  theme: 'dark', // "dark" | "light"
  clockFormat: '24h', // "24h" | "12h"
  soundEnabled: true,
  reducedMotion: false,
  autoStartNextSession: false,
  defaultSessionMinutes: 50,
  lastSelectedMinutes: 50, // last duration chosen in the timer UI
  lastSelectedSubject: null, // last subject chosen in the timer UI (string or null)
});

export const DEFAULT_STUDY_PLAN = Object.freeze({
  startDate: null, // "YYYY-MM-DD" (Gregorian) | null
  examDate: null, // "YYYY-MM-DD" (Gregorian) | null
  totalWeeks: 0,
  dailyGoalMinutes: 240,
});

/** Seed subject list for a brand-new document. Fully user-editable afterward
    (Settings → Subjects) — this is just a helpful starting point. */
export const DEFAULT_SUBJECTS = Object.freeze([
  'ساختمان داده',
  'طراحی الگوریتم',
  'هوش مصنوعی',
  'زبان تخصصی',
  'ریاضی مهندسی ۱',
  'ریاضی مهندسی ۲',
  'آمار و احتمال مهندسی',
  'نظریه زبان‌ها و ماشین‌ها',
  'شبکه‌های کامپیوتری',
  'سیستم‌عامل',
  'پایگاه داده',
  'سیگنال‌ها و سیستم‌ها',
  'مدار منطقی',
]);

/* ------------------------------------------------------------
   Small helpers
   ------------------------------------------------------------ */

const isObj = (v) => v !== null && typeof v === 'object' && !Array.isArray(v);
const isNum = (v) => typeof v === 'number' && Number.isFinite(v);
const isInt = (v) => Number.isInteger(v);

export const toIso = (ms) => new Date(ms).toISOString();
export const fromIso = (iso) => Date.parse(iso);

const ISO_UTC_RE = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;
const DATE_KEY_RE = /^(\d{4})-(\d{2})-(\d{2})$/;

export function isIsoUtc(v) {
  return typeof v === 'string' && ISO_UTC_RE.test(v) && !Number.isNaN(Date.parse(v));
}

export function isDateKey(v) {
  if (typeof v !== 'string') return false;
  const m = DATE_KEY_RE.exec(v);
  if (!m) return false;
  const y = Number(m[1]);
  const mo = Number(m[2]);
  const d = Number(m[3]);
  const dt = new Date(Date.UTC(y, mo - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === mo - 1 && dt.getUTCDate() === d;
}

export function detectTimeZone() {
  try {
    return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  } catch {
    return 'UTC';
  }
}

/** Minutes east of UTC at the given moment (Tehran = 210 or 270). */
export function currentUtcOffsetMinutes(ms = Date.now()) {
  return 0 - new Date(ms).getTimezoneOffset();
}

/** Local calendar day ("YYYY-MM-DD") for a moment, given a UTC offset. */
export function dateKeyOf(ms, offsetMinutes) {
  return new Date(ms + offsetMinutes * 60000).toISOString().slice(0, 10);
}

export function generateId() {
  if (globalThis.crypto && typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }
  const b = globalThis.crypto.getRandomValues(new Uint8Array(16));
  b[6] = (b[6] & 0x0f) | 0x40;
  b[8] = (b[8] & 0x3f) | 0x80;
  const h = [...b].map((x) => x.toString(16).padStart(2, '0')).join('');
  return `${h.slice(0, 8)}-${h.slice(8, 12)}-${h.slice(12, 16)}-${h.slice(16, 20)}-${h.slice(20)}`;
}

/* ------------------------------------------------------------
   Document creation
   ------------------------------------------------------------ */

export function createEmptyDocument(nowMs = Date.now()) {
  const iso = toIso(nowMs);
  return {
    schemaVersion: SCHEMA_VERSION,
    app: {
      name: APP_NAME,
      dataFormat: DATA_FORMAT,
      createdAt: iso,
      updatedAt: iso,
      timeZone: detectTimeZone(),
    },
    settings: { ...DEFAULT_SETTINGS },
    studyPlan: { ...DEFAULT_STUDY_PLAN },
    subjects: [...DEFAULT_SUBJECTS],
    sessions: [],
  };
}

/* ------------------------------------------------------------
   Session records
   ------------------------------------------------------------

   {
     id, type, status, subject,
     planned: { durationSeconds },
     actual:  { startedAt, endedAt, utcOffsetMinutes },
     pauses:  [{ startedAt, endedAt, durationSeconds }],
     derived: { activeDurationSeconds, totalPausedSeconds, pauseCount },
     createdAt, updatedAt
   }

   RAW:     planned, actual, pauses[].startedAt/endedAt, status, subject
   DERIVED: derived.*, pauses[].durationSeconds

   `subject` is a free-text label (or null — "no subject") set only on
   "study" sessions; break sessions always have subject: null. Removing
   a subject from `doc.subjects` later does not touch already-recorded
   sessions — their `subject` string is independent, historical data.
   ------------------------------------------------------------ */

function lastEventMs(rec) {
  let t = fromIso(rec.actual.startedAt);
  for (const p of rec.pauses) {
    t = Math.max(t, fromIso(p.startedAt));
    if (p.endedAt) t = Math.max(t, fromIso(p.endedAt));
  }
  return t;
}

export function pausedMs(rec, refMs) {
  const endRef = rec.actual.endedAt ? fromIso(rec.actual.endedAt) : refMs;
  let total = 0;
  for (const p of rec.pauses) {
    const s = fromIso(p.startedAt);
    const e = p.endedAt ? fromIso(p.endedAt) : endRef;
    total += Math.max(0, e - s);
  }
  return total;
}

/** Real active time, from timestamps only (never from tick counting). */
export function activeMs(rec, nowMs) {
  const start = fromIso(rec.actual.startedAt);
  const end = rec.actual.endedAt ? fromIso(rec.actual.endedAt) : nowMs;
  return Math.max(0, end - start - pausedMs(rec, nowMs));
}

export function remainingMsOf(rec, nowMs) {
  return Math.max(0, rec.planned.durationSeconds * 1000 - activeMs(rec, nowMs));
}

/** Wall-clock moment a *running* session reaches its planned duration. */
export function targetEndMs(rec) {
  return fromIso(rec.actual.startedAt) + rec.planned.durationSeconds * 1000 + pausedMs(rec, 0);
}

export function computeDerived(rec, nowMs = Date.now()) {
  return {
    activeDurationSeconds: Math.round(activeMs(rec, nowMs) / 1000),
    totalPausedSeconds: Math.round(pausedMs(rec, nowMs) / 1000),
    pauseCount: rec.pauses.length,
  };
}

function touchRecord(rec, nowMs) {
  rec.derived = computeDerived(rec, nowMs);
  rec.updatedAt = toIso(nowMs);
}

function closePause(p, endMs) {
  const t = Math.max(endMs, fromIso(p.startedAt));
  p.endedAt = toIso(t);
  p.durationSeconds = Math.round((t - fromIso(p.startedAt)) / 1000);
}

export function createSessionRecord({ type, durationSeconds, subject = null, nowMs = Date.now() }) {
  const iso = toIso(nowMs);
  const rec = {
    id: generateId(),
    type,
    status: 'running',
    subject: type === 'study' && subject ? subject : null,
    planned: { durationSeconds },
    actual: {
      startedAt: iso,
      endedAt: null,
      utcOffsetMinutes: currentUtcOffsetMinutes(nowMs),
    },
    pauses: [],
    derived: null,
    createdAt: iso,
    updatedAt: iso,
  };
  rec.derived = computeDerived(rec, nowMs);
  return rec;
}

export function pauseRecord(rec, nowMs) {
  if (rec.status !== 'running') return false;
  const t = Math.max(nowMs, lastEventMs(rec));
  rec.pauses.push({ startedAt: toIso(t), endedAt: null, durationSeconds: null });
  rec.status = 'paused';
  touchRecord(rec, nowMs);
  return true;
}

export function resumeRecord(rec, nowMs) {
  if (rec.status !== 'paused') return false;
  const open = rec.pauses[rec.pauses.length - 1];
  closePause(open, Math.max(nowMs, lastEventMs(rec)));
  rec.status = 'running';
  touchRecord(rec, nowMs);
  return true;
}

/** status: "completed" | "abandoned" | "cancelled" */
export function finalizeRecord(rec, status, endMs) {
  if (!ACTIVE_STATUSES.includes(rec.status)) return false;
  const t = Math.max(endMs, lastEventMs(rec));
  const last = rec.pauses[rec.pauses.length - 1];
  if (last && last.endedAt === null) closePause(last, t);
  rec.actual.endedAt = toIso(t);
  rec.status = status;
  touchRecord(rec, Date.now());
  return true;
}

export function findActiveRecord(sessions) {
  for (let i = sessions.length - 1; i >= 0; i--) {
    if (ACTIVE_STATUSES.includes(sessions[i].status)) return sessions[i];
  }
  return null;
}

export function sessionDayKey(rec) {
  return dateKeyOf(fromIso(rec.actual.startedAt), rec.actual.utcOffsetMinutes);
}

export function isCountedSession(rec) {
  return (
    (rec.status === 'completed' || rec.status === 'abandoned') &&
    rec.derived &&
    rec.derived.activeDurationSeconds >= MIN_COUNTED_SECONDS
  );
}

/* ------------------------------------------------------------
   Derived data (always rebuildable from sessions)
   ------------------------------------------------------------ */

export function buildDailySummaries(sessions) {
  const days = {};
  for (const rec of sessions) {
    if (rec.type !== 'study' || !isCountedSession(rec)) continue;
    const key = sessionDayKey(rec);
    const d = (days[key] ||= { studySeconds: 0, sessionCount: 0, completedSessionCount: 0 });
    d.studySeconds += rec.derived.activeDurationSeconds;
    d.sessionCount += 1;
    if (rec.status === 'completed') d.completedSessionCount += 1;
  }
  return Object.fromEntries(Object.entries(days).sort(([a], [b]) => (a < b ? -1 : 1)));
}

/**
 * Per-subject totals across counted study sessions, sorted by time desc.
 * Pass `dayKey` to scope it to one local calendar day (e.g. "today");
 * omit it for an all-time breakdown. Sessions with no subject are skipped.
 */
export function buildSubjectSummaries(sessions, { dayKey = null } = {}) {
  const bySubject = new Map();
  for (const rec of sessions) {
    if (rec.type !== 'study' || !rec.subject || !isCountedSession(rec)) continue;
    if (dayKey && sessionDayKey(rec) !== dayKey) continue;
    const entry = bySubject.get(rec.subject) || {
      subject: rec.subject,
      studySeconds: 0,
      sessionCount: 0,
    };
    entry.studySeconds += rec.derived.activeDurationSeconds;
    entry.sessionCount += 1;
    bySubject.set(rec.subject, entry);
  }
  return [...bySubject.values()].sort((a, b) => b.studySeconds - a.studySeconds);
}

/* ------------------------------------------------------------
   Serialization
   ------------------------------------------------------------ */

export function serializeDocument(doc, nowMs = Date.now()) {
  const sessions = doc.sessions.map((rec) =>
    ACTIVE_STATUSES.includes(rec.status) ? { ...rec, derived: computeDerived(rec, nowMs) } : rec
  );

  const out = {
    ...doc,
    app: { ...doc.app, updatedAt: toIso(nowMs), timeZone: detectTimeZone() },
    sessions,
    derived: {
      note: 'Rebuildable from `sessions`. Safe to ignore or delete; regenerated on every save.',
      generatedAt: toIso(nowMs),
      dailySummaries: buildDailySummaries(sessions),
      subjectSummaries: buildSubjectSummaries(sessions),
    },
  };

  return JSON.stringify(out, null, 2) + '\n';
}

/* ------------------------------------------------------------
   Migration

   To add schema v2:
     1. bump SCHEMA_VERSION to 2
     2. write migrateV1ToV2(doc) that returns a doc with schemaVersion = 2
     3. register it below:  1: migrateV1ToV2

   (Adding `subjects` / `sessions[].subject` did NOT need a migration —
   normalizeDocument()/finalizeLoadedDocument() below default them for
   any file saved before this feature existed, the same way settings/
   studyPlan already default missing keys.)
   ------------------------------------------------------------ */

const MIGRATIONS = {
  // 1: migrateV1ToV2,
  // 2: migrateV2ToV3,
};

export function migrateData(input) {
  let data = input;
  let version = data.schemaVersion;

  if (!isInt(version) || version < 1) {
    throw new DataError(INVALID_FILE_MESSAGE, ['schemaVersion must be a positive integer']);
  }
  if (version > SCHEMA_VERSION) {
    throw new DataError(INVALID_FILE_MESSAGE, [
      `File schemaVersion ${version} is newer than this app supports (${SCHEMA_VERSION})`,
    ]);
  }

  while (version < SCHEMA_VERSION) {
    const step = MIGRATIONS[version];
    if (typeof step !== 'function') {
      throw new DataError(INVALID_FILE_MESSAGE, [
        `No migration available from schemaVersion ${version}`,
      ]);
    }
    data = step(data);
    if (!data || data.schemaVersion !== version + 1) {
      throw new DataError(INVALID_FILE_MESSAGE, [`Migration from schemaVersion ${version} failed`]);
    }
    version = data.schemaVersion;
  }
  return data;
}

/* ------------------------------------------------------------
   Validation
   ------------------------------------------------------------ */

function validateSettings(s, err) {
  if (!isObj(s)) return err('settings must be an object');
  if (!['fa', 'en'].includes(s.language)) err('settings.language must be "fa" or "en"');
  if (!['dark', 'light'].includes(s.theme)) err('settings.theme must be "dark" or "light"');
  if (!['24h', '12h'].includes(s.clockFormat)) err('settings.clockFormat must be "24h" or "12h"');
  for (const k of ['soundEnabled', 'reducedMotion', 'autoStartNextSession']) {
    if (typeof s[k] !== 'boolean') err(`settings.${k} must be a boolean`);
  }
  if (
    !isInt(s.defaultSessionMinutes) ||
    s.defaultSessionMinutes < 1 ||
    s.defaultSessionMinutes > 600
  ) {
    err('settings.defaultSessionMinutes must be an integer between 1 and 600');
  }
  if (!isInt(s.lastSelectedMinutes) || s.lastSelectedMinutes < 1 || s.lastSelectedMinutes > 1440) {
    err('settings.lastSelectedMinutes must be an integer between 1 and 1440');
  }
  if (s.lastSelectedSubject !== null && typeof s.lastSelectedSubject !== 'string') {
    err('settings.lastSelectedSubject must be null or a string');
  }
}

function validateStudyPlan(p, err) {
  if (!isObj(p)) return err('studyPlan must be an object');
  for (const k of ['startDate', 'examDate']) {
    if (p[k] !== null && !isDateKey(p[k]))
      err(`studyPlan.${k} must be null or a "YYYY-MM-DD" date`);
  }
  if (isDateKey(p.startDate) && isDateKey(p.examDate) && p.examDate <= p.startDate) {
    err('studyPlan.examDate must be after studyPlan.startDate');
  }
  if (!isInt(p.totalWeeks) || p.totalWeeks < 0 || p.totalWeeks > 520) {
    err('studyPlan.totalWeeks must be an integer between 0 and 520');
  }
  if (!isNum(p.dailyGoalMinutes) || p.dailyGoalMinutes <= 0 || p.dailyGoalMinutes > 1440) {
    err('studyPlan.dailyGoalMinutes must be a number between 1 and 1440');
  }
}

function validateSubjects(subjects, err) {
  if (!Array.isArray(subjects)) return err('subjects must be an array');
  if (subjects.length > MAX_SUBJECTS) err(`subjects must have at most ${MAX_SUBJECTS} entries`);
  const seen = new Set();
  subjects.forEach((s, i) => {
    if (typeof s !== 'string' || !s.trim()) {
      err(`subjects[${i}] must be a non-empty string`);
      return;
    }
    if (s.length > MAX_SUBJECT_LENGTH)
      err(`subjects[${i}] is too long (max ${MAX_SUBJECT_LENGTH} chars)`);
    if (seen.has(s)) err(`subjects[${i}] "${s}" is duplicated`);
    seen.add(s);
  });
}

function validateSession(rec, index, seenIds, err) {
  const p = `sessions[${index}]`;
  if (!isObj(rec)) return err(`${p} must be an object`);

  if (typeof rec.id !== 'string' || rec.id.trim() === '') err(`${p}.id must be a non-empty string`);
  else if (seenIds.has(rec.id)) err(`${p}.id "${rec.id}" is duplicated`);
  else seenIds.add(rec.id);

  if (!SESSION_TYPES.includes(rec.type))
    err(`${p}.type must be one of: ${SESSION_TYPES.join(', ')}`);
  const statusOk = SESSION_STATUSES.includes(rec.status);
  if (!statusOk) err(`${p}.status must be one of: ${SESSION_STATUSES.join(', ')}`);
  const active = statusOk && ACTIVE_STATUSES.includes(rec.status);

  if (rec.subject !== null && (typeof rec.subject !== 'string' || !rec.subject.trim())) {
    err(`${p}.subject must be null or a non-empty string`);
  }
  if (rec.type === 'break' && rec.subject !== null) {
    err(`${p}.subject must be null for break sessions`);
  }

  if (
    !isObj(rec.planned) ||
    !isNum(rec.planned.durationSeconds) ||
    rec.planned.durationSeconds <= 0 ||
    rec.planned.durationSeconds > MAX_SESSION_SECONDS
  ) {
    err(`${p}.planned.durationSeconds must be a positive number (max ${MAX_SESSION_SECONDS})`);
  }

  if (!isObj(rec.actual)) return err(`${p}.actual must be an object`);
  const a = rec.actual;

  let startMs = NaN;
  let endMs = null;

  if (!isIsoUtc(a.startedAt)) err(`${p}.actual.startedAt must be an ISO 8601 UTC timestamp`);
  else startMs = fromIso(a.startedAt);

  if (a.endedAt === null) {
    if (statusOk && !active) err(`${p}.actual.endedAt is required when status is "${rec.status}"`);
  } else if (!isIsoUtc(a.endedAt)) {
    err(`${p}.actual.endedAt must be null or an ISO 8601 UTC timestamp`);
  } else {
    endMs = fromIso(a.endedAt);
    if (active) err(`${p}.actual.endedAt must be null while status is "${rec.status}"`);
    if (endMs < startMs) err(`${p}.actual.endedAt is before startedAt`);
  }

  if (!isInt(a.utcOffsetMinutes) || Math.abs(a.utcOffsetMinutes) > 840) {
    err(`${p}.actual.utcOffsetMinutes must be an integer between -840 and 840`);
  }

  if (!Array.isArray(rec.pauses)) {
    err(`${p}.pauses must be an array`);
  } else {
    let cursor = startMs;
    rec.pauses.forEach((pz, i) => {
      const q = `${p}.pauses[${i}]`;
      if (!isObj(pz)) return err(`${q} must be an object`);
      if (!isIsoUtc(pz.startedAt)) return err(`${q}.startedAt must be an ISO 8601 UTC timestamp`);
      const s = fromIso(pz.startedAt);
      if (s < cursor) err(`${q} overlaps or precedes the previous event`);

      if (pz.endedAt === null) {
        if (!(rec.status === 'paused' && i === rec.pauses.length - 1)) {
          err(`${q}.endedAt can be null only for the last pause of a paused session`);
        }
        cursor = s;
      } else if (!isIsoUtc(pz.endedAt)) {
        err(`${q}.endedAt must be null or an ISO 8601 UTC timestamp`);
      } else {
        const e = fromIso(pz.endedAt);
        if (e < s) err(`${q}.endedAt is before startedAt`);
        if (endMs !== null && e > endMs) err(`${q} ends after the session ended`);
        cursor = e;
      }
    });

    if (rec.status === 'paused') {
      const last = rec.pauses[rec.pauses.length - 1];
      if (!last || last.endedAt !== null) err(`${p} is "paused" but has no open pause`);
    }
  }

  if (!isIsoUtc(rec.createdAt)) err(`${p}.createdAt must be an ISO 8601 UTC timestamp`);
  if (!isIsoUtc(rec.updatedAt)) err(`${p}.updatedAt must be an ISO 8601 UTC timestamp`);
}

export function validateDocument(doc) {
  const errors = [];
  const err = (m) => {
    if (errors.length < MAX_ERRORS) errors.push(m);
  };

  if (!isObj(doc)) {
    err('Root must be a JSON object');
    return errors;
  }

  if (doc.schemaVersion !== SCHEMA_VERSION) err(`schemaVersion must be ${SCHEMA_VERSION}`);

  if (!isObj(doc.app)) {
    err('app must be an object');
  } else {
    if (doc.app.dataFormat !== DATA_FORMAT) err(`app.dataFormat must be "${DATA_FORMAT}"`);
    if (!isIsoUtc(doc.app.createdAt)) err('app.createdAt must be an ISO 8601 UTC timestamp');
    if (!isIsoUtc(doc.app.updatedAt)) err('app.updatedAt must be an ISO 8601 UTC timestamp');
  }

  validateSettings(doc.settings, err);
  validateStudyPlan(doc.studyPlan, err);
  validateSubjects(doc.subjects, err);

  if (!Array.isArray(doc.sessions)) {
    err('sessions must be an array');
  } else {
    const seen = new Set();
    doc.sessions.forEach((rec, i) => validateSession(rec, i, seen, err));
    const activeCount = doc.sessions.filter(
      (r) => isObj(r) && ACTIVE_STATUSES.includes(r.status)
    ).length;
    if (activeCount > 1) err('Only one session can be running or paused at a time');
  }

  return errors;
}

/* ------------------------------------------------------------
   Parse (JSON text -> validated, migrated document)
   ------------------------------------------------------------ */

function normalizeDocument(raw) {
  return {
    ...raw,
    app: isObj(raw.app) ? { ...raw.app } : raw.app,
    settings:
      raw.settings === undefined
        ? { ...DEFAULT_SETTINGS }
        : isObj(raw.settings)
          ? { ...DEFAULT_SETTINGS, ...raw.settings }
          : raw.settings,
    studyPlan:
      raw.studyPlan === undefined
        ? { ...DEFAULT_STUDY_PLAN }
        : isObj(raw.studyPlan)
          ? { ...DEFAULT_STUDY_PLAN, ...raw.studyPlan }
          : raw.studyPlan,
    subjects: raw.subjects === undefined ? [...DEFAULT_SUBJECTS] : raw.subjects,
  };
}

function finalizeLoadedDocument(doc, nowMs = Date.now()) {
  delete doc.derived; // never trust stored derived data
  for (const rec of doc.sessions) {
    if (rec.subject === undefined) rec.subject = null; // files saved before this feature existed
    for (const p of rec.pauses) {
      p.durationSeconds = p.endedAt
        ? Math.max(0, Math.round((fromIso(p.endedAt) - fromIso(p.startedAt)) / 1000))
        : null;
    }
    rec.derived = computeDerived(rec, nowMs);
  }
}

export function parseDocument(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new DataError(INVALID_FILE_MESSAGE, ['File is not valid JSON']);
  }
  if (!isObj(raw)) throw new DataError(INVALID_FILE_MESSAGE, ['Root must be a JSON object']);

  const migrated = migrateData(structuredClone(raw));
  const doc = normalizeDocument(migrated);

  const errors = validateDocument(doc);
  if (errors.length) throw new DataError(INVALID_FILE_MESSAGE, errors);

  finalizeLoadedDocument(doc);
  return doc;
}
