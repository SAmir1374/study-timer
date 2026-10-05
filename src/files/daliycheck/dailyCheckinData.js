/* =============================================================
   dailyCheckinData.js — pure data model for daily-checkins.json
   ============================================================= */

export const CHECKIN_SCHEMA_VERSION = 1;
export const CHECKIN_DATA_FORMAT = "daily-checkin-json";
export const DEFAULT_CHECKIN_FILE_NAME = "daily-checkins.json";
export const INVALID_CHECKIN_MESSAGE = "Invalid daily-checkin file";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const MAX_ENTRIES = 10000;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);

export class CheckinDataError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "CheckinDataError";
    this.details = details;
  }
}

/* ------------------------------------------------------------ */

export function createEmptyCheckinDocument(nowMs = Date.now()) {
  const iso = new Date(nowMs).toISOString();
  return {
    schemaVersion: CHECKIN_DATA_FORMAT,
    version: CHECKIN_SCHEMA_VERSION,
    app: "Study Timer",
    createdAt: iso,
    updatedAt: iso,
    entries: [],
  };
}

export function createCheckinEntry(dateKey, nowMs = Date.now()) {
  return {
    date: dateKey,
    sleep: {
      bedTime: null,
      wakeTime: null,
      hours: null,
      quality: null,
    },
    relaxationRoutine: {
      done: false,
      steps: null,
    },
    activity1: null,
    operation1: null,
    yesterdayQuality: null,
    exercise: {
      done: false,
      minutes: null,
    },
    recordedAt: new Date(nowMs).toISOString(),
  };
}

/* ------------------------------------------------------------ */

function validateEntry(entry, index, seenDates, err) {
  const p = `entries[${index}]`;
  if (!isObj(entry)) return err(`${p} must be an object`);

  if (typeof entry.date !== "string" || !DATE_KEY_RE.test(entry.date)) {
    err(`${p}.date must be a "YYYY-MM-DD" date`);
  } else if (seenDates.has(entry.date)) {
    err(`${p}.date "${entry.date}" is duplicated`);
  } else {
    seenDates.add(entry.date);
  }

  // sleep
  if (!isObj(entry.sleep)) {
    err(`${p}.sleep must be an object`);
  } else {
    const s = entry.sleep;
    if (s.bedTime !== null && !TIME_RE.test(s.bedTime)) err(`${p}.sleep.bedTime must be null or "HH:MM"`);
    if (s.wakeTime !== null && !TIME_RE.test(s.wakeTime)) err(`${p}.sleep.wakeTime must be null or "HH:MM"`);
    if (s.hours !== null && (!isNum(s.hours) || s.hours < 0 || s.hours > 24)) {
      err(`${p}.sleep.hours must be null or a number between 0 and 24`);
    }
    if (s.quality !== null && (!isInt(s.quality) || s.quality < 1 || s.quality > 10)) {
      err(`${p}.sleep.quality must be null or an integer between 1 and 10`);
    }
  }

  // relaxation routine
  if (!isObj(entry.relaxationRoutine)) {
    err(`${p}.relaxationRoutine must be an object`);
  } else {
    const r = entry.relaxationRoutine;
    if (typeof r.done !== "boolean") err(`${p}.relaxationRoutine.done must be a boolean`);
    if (r.steps !== null && (!isInt(r.steps) || r.steps < 0 || r.steps > 100)) {
      err(`${p}.relaxationRoutine.steps must be null or an integer between 0 and 100`);
    }
  }

  if (entry.activity1 !== null && typeof entry.activity1 !== "boolean") {
    err(`${p}.activity1 must be null or a boolean`);
  }
  if (entry.operation1 !== null && typeof entry.operation1 !== "boolean") {
    err(`${p}.operation1 must be null or a boolean`);
  }

  if (
    entry.yesterdayQuality !== null &&
    (!isInt(entry.yesterdayQuality) || entry.yesterdayQuality < 1 || entry.yesterdayQuality > 10)
  ) {
    err(`${p}.yesterdayQuality must be null or an integer between 1 and 10`);
  }

  // exercise
  if (!isObj(entry.exercise)) {
    err(`${p}.exercise must be an object`);
  } else {
    const e = entry.exercise;
    if (typeof e.done !== "boolean") err(`${p}.exercise.done must be a boolean`);
    if (e.minutes !== null && (!isInt(e.minutes) || e.minutes < 0 || e.minutes > 600)) {
      err(`${p}.exercise.minutes must be null or an integer between 0 and 600`);
    }
  }

  if (typeof entry.recordedAt !== "string" || Number.isNaN(Date.parse(entry.recordedAt))) {
    err(`${p}.recordedAt must be an ISO 8601 timestamp`);
  }
}

export function validateCheckinDocument(doc) {
  const errors = [];
  const err = (m) => {
    if (errors.length < 25) errors.push(m);
  };

  if (!isObj(doc)) {
    err("Root must be a JSON object");
    return errors;
  }
  if (doc.schemaVersion !== CHECKIN_DATA_FORMAT) err(`schemaVersion must be "${CHECKIN_DATA_FORMAT}"`);
  if (doc.version !== CHECKIN_SCHEMA_VERSION) err(`version must be ${CHECKIN_SCHEMA_VERSION}`);

  if (!Array.isArray(doc.entries)) {
    err("entries must be an array");
  } else {
    if (doc.entries.length > MAX_ENTRIES) err(`entries must have at most ${MAX_ENTRIES} items`);
    const seen = new Set();
    doc.entries.forEach((e, i) => validateEntry(e, i, seen, err));
  }

  return errors;
}

/* ------------------------------------------------------------ */

export function serializeCheckinDocument(doc, nowMs = Date.now()) {
  const out = { ...doc, updatedAt: new Date(nowMs).toISOString() };
  return JSON.stringify(out, null, 2) + "\n";
}

export function parseCheckinDocument(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new CheckinDataError(INVALID_CHECKIN_MESSAGE, ["File is not valid JSON"]);
  }
  if (!isObj(raw)) throw new CheckinDataError(INVALID_CHECKIN_MESSAGE, ["Root must be a JSON object"]);

  const doc = {
    ...createEmptyCheckinDocument(),
    ...raw,
    entries: Array.isArray(raw.entries) ? raw.entries : [],
  };

  const errors = validateCheckinDocument(doc);
  if (errors.length) throw new CheckinDataError(INVALID_CHECKIN_MESSAGE, errors);
  return doc;
}

/* ------------------------------------------------------------ */

export function findEntryByDate(doc, dateKey) {
  return doc.entries.find((e) => e.date === dateKey) || null;
}

export function upsertEntry(doc, entry) {
  const idx = doc.entries.findIndex((e) => e.date === entry.date);
  if (idx === -1) doc.entries.push(entry);
  else doc.entries[idx] = entry;
  doc.entries.sort((a, b) => (a.date < b.date ? 1 : -1)); // newest first
  return doc;
}