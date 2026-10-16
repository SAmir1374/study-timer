/* =============================================================
   dailyCheckinData.js — pure data model for daily-checkins.json
   Schema v4: two slots per day, multi-item questionnaires,
   ADHD-medication doses, explicit-content log, meal log.
   ============================================================= */

export const CHECKIN_SCHEMA_VERSION = 4;
export const CHECKIN_DATA_FORMAT = "daily-checkin-json";
export const DEFAULT_CHECKIN_FILE_NAME = "daily-checkins.json";
export const INVALID_CHECKIN_MESSAGE = "Invalid daily-checkin file";

const DATE_KEY_RE = /^\d{4}-\d{2}-\d{2}$/;
const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;
const FOOD_ID_RE = /^[a-z0-9-]{1,40}$/;
const MEAL_KEYS = ["breakfast", "lunch", "dinner", "snack"];
const MAX_ENTRIES = 10000;
const MAX_NOTES_LEN = 500;
const MAX_OTHER_FOOD_LEN = 200;
const MAX_ITEMS = 80;
const MAX_FOOD_PER_MEAL = 40;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isScore = (v) => isNum(v) && v >= 1 && v <= 10;

export class CheckinDataError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "CheckinDataError";
    this.details = details;
  }
}

/* ---------- default factories ---------- */

const emptySlots = () => ({ morning: null, evening: null });
const emptySleep = () => ({
  bedTime: null,
  wakeTime: null,
  hours: null,
  latencyMin: null,
  awakenings: null,
  quality: null,
  restedness: null,
});
const emptyRoutine = () => ({ done: false, steps: null, effectiveness: null });
const emptyMorningState = () => ({ mood: null, energy: null, tension: null });
const emptyMood = () => ({ rating: null, stress: null, energy: null, focus: null, anxiety: null });
const emptyMast = () => ({
  positive: { done: false, count: null },
  negative: { done: false, count: null },
});
const emptyFoodLog = () => ({ breakfast: [], lunch: [], dinner: [], snack: [] });
const emptyFood = () => ({
  meals: null,
  quality: null,
  water: false,
  caffeine: null,
  log: emptyFoodLog(),
  other: null,
  logged: false, // false = «ثبت نشده»، نه «چیزی نخورد»
});
const emptyDose = () => ({ taken: false, amount: null, time: null });
// recorded=false → سؤال هنوز پرسیده/ثبت نشده (روزهای قدیمی)؛ taken=false آنجا یعنی «نامشخص»
const emptyMedication = () => ({ recorded: false, morning: emptyDose(), afternoon: emptyDose() });
const emptyExplicit = () => ({ recorded: false, viewed: false, minutes: null, driver: null });

/* ---------- date helper (محلی) ---------- */

export function localDateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* ---------- document / entry factories ---------- */

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
    slots: emptySlots(),
    sleep: emptySleep(),
    relaxationRoutine: emptyRoutine(),
    medication: emptyMedication(),
    morningState: emptyMorningState(),
    mood: emptyMood(),
    items: {},
    activity1: null,
    operation1: null,
    masturbation: emptyMast(),
    explicit: emptyExplicit(),
    food: emptyFood(),
    dayRating: null,
    yesterdayQuality: null, // legacy (v1/v2)
    exercise: { done: false, minutes: null },
    notes: null,
    recordedAt: new Date(nowMs).toISOString(),
  };
}

/* ---------- کدام چک‌این الان نوبتش است؟ ----------
   ۰۴:۰۰–۱۸:۰۰ → صبح (برای امروز)
   ۱۸:۰۰–۰۴:۰۰ → شب (بعد از نیمه‌شب برای دیروز)
   اگر آن اسلات قبلاً ثبت شده باشد → null */
export function getDueSlot(doc, now = new Date()) {
  const h = now.getHours();
  const eveningWindow = h >= 18 || h < 4;
  const d = new Date(now);
  if (h < 4) d.setDate(d.getDate() - 1);
  const dateKey = localDateKey(d);
  const entry = findEntryByDate(doc, dateKey) || createCheckinEntry(dateKey);
  const slot = eveningWindow ? "evening" : "morning";
  if (entry.slots?.[slot]) return null;
  return { slot, dateKey, entry };
}

/* ------------------------------------------------------------ */

function validateEntry(entry, index, seenDates, err) {
  const p = `entries[${index}]`;
  if (!isObj(entry)) return err(`${p} must be an object`);

  const score = (path, v) => {
    if (v !== null && !isScore(v)) err(`${path} must be null or a number between 1 and 10`);
  };
  const intIn = (path, v, lo, hi) => {
    if (v !== null && (!isInt(v) || v < lo || v > hi)) {
      err(`${path} must be null or an integer between ${lo} and ${hi}`);
    }
  };

  if (typeof entry.date !== "string" || !DATE_KEY_RE.test(entry.date)) {
    err(`${p}.date must be a "YYYY-MM-DD" date`);
  } else if (seenDates.has(entry.date)) {
    err(`${p}.date "${entry.date}" is duplicated`);
  } else {
    seenDates.add(entry.date);
  }

  // slots
  if (!isObj(entry.slots)) {
    err(`${p}.slots must be an object`);
  } else {
    for (const k of ["morning", "evening"]) {
      const v = entry.slots[k];
      if (v !== null && (typeof v !== "string" || Number.isNaN(Date.parse(v)))) {
        err(`${p}.slots.${k} must be null or an ISO 8601 timestamp`);
      }
    }
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
    intIn(`${p}.sleep.latencyMin`, s.latencyMin, 0, 600);
    intIn(`${p}.sleep.awakenings`, s.awakenings, 0, 20);
    score(`${p}.sleep.quality`, s.quality);
    score(`${p}.sleep.restedness`, s.restedness);
  }

  // relaxation routine
  if (!isObj(entry.relaxationRoutine)) {
    err(`${p}.relaxationRoutine must be an object`);
  } else {
    const r = entry.relaxationRoutine;
    if (typeof r.done !== "boolean") err(`${p}.relaxationRoutine.done must be a boolean`);
    intIn(`${p}.relaxationRoutine.steps`, r.steps, 0, 100);
    score(`${p}.relaxationRoutine.effectiveness`, r.effectiveness);
  }

  // medication (ADHD)
  if (!isObj(entry.medication)) {
    err(`${p}.medication must be an object`);
  } else {
    const md = entry.medication;
    if (typeof md.recorded !== "boolean") err(`${p}.medication.recorded must be a boolean`);
    for (const k of ["morning", "afternoon"]) {
      const d = md[k];
      if (!isObj(d)) { err(`${p}.medication.${k} must be an object`); continue; }
      if (typeof d.taken !== "boolean") err(`${p}.medication.${k}.taken must be a boolean`);
      if (d.amount !== null && (!isNum(d.amount) || d.amount <= 0 || d.amount > 4)) {
        err(`${p}.medication.${k}.amount must be null or a number in (0, 4]`);
      }
      if (d.time !== null && !TIME_RE.test(d.time)) err(`${p}.medication.${k}.time must be null or "HH:MM"`);
    }
  }

  // morning "right now" state
  if (!isObj(entry.morningState)) {
    err(`${p}.morningState must be an object`);
  } else {
    for (const k of ["mood", "energy", "tension"]) score(`${p}.morningState.${k}`, entry.morningState[k]);
  }

  // evening composites
  if (!isObj(entry.mood)) {
    err(`${p}.mood must be an object`);
  } else {
    for (const k of ["rating", "stress", "energy", "focus", "anxiety"]) score(`${p}.mood.${k}`, entry.mood[k]);
  }

  // raw item answers (1–5)
  if (!isObj(entry.items)) {
    err(`${p}.items must be an object`);
  } else {
    const keys = Object.keys(entry.items);
    if (keys.length > MAX_ITEMS) err(`${p}.items must have at most ${MAX_ITEMS} keys`);
    for (const k of keys) {
      const v = entry.items[k];
      if (v !== null && (!isInt(v) || v < 1 || v > 5)) {
        err(`${p}.items.${k} must be null or an integer between 1 and 5`);
      }
    }
  }

  if (entry.activity1 !== null && typeof entry.activity1 !== "boolean") {
    err(`${p}.activity1 must be null or a boolean`);
  }
  if (entry.operation1 !== null && typeof entry.operation1 !== "boolean") {
    err(`${p}.operation1 must be null or a boolean`);
  }

  // masturbation
  if (!isObj(entry.masturbation)) {
    err(`${p}.masturbation must be an object`);
  } else {
    for (const k of ["positive", "negative"]) {
      const m = entry.masturbation[k];
      if (!isObj(m)) { err(`${p}.masturbation.${k} must be an object`); continue; }
      if (typeof m.done !== "boolean") err(`${p}.masturbation.${k}.done must be a boolean`);
      intIn(`${p}.masturbation.${k}.count`, m.count, 0, 20);
    }
  }

  // explicit content
  if (!isObj(entry.explicit)) {
    err(`${p}.explicit must be an object`);
  } else {
    const x = entry.explicit;
    if (typeof x.recorded !== "boolean") err(`${p}.explicit.recorded must be a boolean`);
    if (typeof x.viewed !== "boolean") err(`${p}.explicit.viewed must be a boolean`);
    intIn(`${p}.explicit.minutes`, x.minutes, 0, 1440);
    if (x.driver !== null && x.driver !== "choice" && x.driver !== "urge") {
      err(`${p}.explicit.driver must be null, "choice" or "urge"`);
    }
  }

  // food
  if (!isObj(entry.food)) {
    err(`${p}.food must be an object`);
  } else {
    const f = entry.food;
    intIn(`${p}.food.meals`, f.meals, 0, 10);
    score(`${p}.food.quality`, f.quality);
    if (typeof f.water !== "boolean") err(`${p}.food.water must be a boolean`);
    intIn(`${p}.food.caffeine`, f.caffeine, 0, 20);
    if (typeof f.logged !== "boolean") err(`${p}.food.logged must be a boolean`);
    if (f.other !== null && (typeof f.other !== "string" || f.other.length > MAX_OTHER_FOOD_LEN)) {
      err(`${p}.food.other must be null or a string of at most ${MAX_OTHER_FOOD_LEN} characters`);
    }
    if (!isObj(f.log)) {
      err(`${p}.food.log must be an object`);
    } else {
      for (const m of MEAL_KEYS) {
        const arr = f.log[m];
        if (!Array.isArray(arr) || arr.length > MAX_FOOD_PER_MEAL) {
          err(`${p}.food.log.${m} must be an array of at most ${MAX_FOOD_PER_MEAL} ids`);
        } else if (arr.some((id) => typeof id !== "string" || !FOOD_ID_RE.test(id))) {
          err(`${p}.food.log.${m} contains an invalid food id`);
        }
      }
    }
  }

  score(`${p}.dayRating`, entry.dayRating);
  score(`${p}.yesterdayQuality`, entry.yesterdayQuality);

  // exercise
  if (!isObj(entry.exercise)) {
    err(`${p}.exercise must be an object`);
  } else {
    const e = entry.exercise;
    if (typeof e.done !== "boolean") err(`${p}.exercise.done must be a boolean`);
    intIn(`${p}.exercise.minutes`, e.minutes, 0, 600);
  }

  if (entry.notes !== null && typeof entry.notes !== "string") {
    err(`${p}.notes must be null or a string`);
  } else if (typeof entry.notes === "string" && entry.notes.length > MAX_NOTES_LEN) {
    err(`${p}.notes must be at most ${MAX_NOTES_LEN} characters`);
  }

  if (typeof entry.recordedAt !== "string" || Number.isNaN(Date.parse(entry.recordedAt))) {
    err(`${p}.recordedAt must be an ISO 8601 timestamp`);
  }
}

export function validateCheckinDocument(doc) {
  const errors = [];
  const err = (m) => { if (errors.length < 25) errors.push(m); };

  if (!isObj(doc)) { err("Root must be a JSON object"); return errors; }
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

/* ---------- migrations ---------- */

function migrateEntryV1toV2(e) {
  const dateKey = isObj(e) && typeof e.date === "string" && DATE_KEY_RE.test(e.date)
    ? e.date
    : "1970-01-01";
  const base = createCheckinEntry(dateKey);
  return {
    ...base,
    ...e,
    sleep: { ...base.sleep, ...(isObj(e?.sleep) ? e.sleep : {}) },
    relaxationRoutine: {
      ...base.relaxationRoutine,
      ...(isObj(e?.relaxationRoutine) ? e.relaxationRoutine : {}),
      effectiveness: null,
    },
    mood: { ...base.mood },
    masturbation: emptyMast(),
    food: emptyFood(),
    notes: null,
  };
}

function migrateV1toV2(raw) {
  const entries = Array.isArray(raw.entries) ? raw.entries.map(migrateEntryV1toV2) : [];
  return { ...raw, version: 2, entries };
}

function migrateEntryV2toV3(e) {
  const dateKey = isObj(e) && typeof e.date === "string" && DATE_KEY_RE.test(e.date)
    ? e.date
    : "1970-01-01";
  const base = createCheckinEntry(dateKey);
  const stamp = typeof e?.recordedAt === "string" ? e.recordedAt : base.recordedAt;
  return {
    ...base,
    ...e,
    // ورودی‌های قدیمی تک‌مرحله‌ای بودند → هر دو اسلات «ثبت‌شده»
    slots: { morning: stamp, evening: stamp },
    sleep: { ...base.sleep, ...(isObj(e?.sleep) ? e.sleep : {}) },
    relaxationRoutine: { ...base.relaxationRoutine, ...(isObj(e?.relaxationRoutine) ? e.relaxationRoutine : {}) },
    morningState: emptyMorningState(),
    mood: { ...base.mood, ...(isObj(e?.mood) ? e.mood : {}) },
    items: {},
    food: { ...base.food, ...(isObj(e?.food) ? e.food : {}) },
    dayRating: null,
  };
}

function migrateV2toV3(raw) {
  const entries = Array.isArray(raw.entries) ? raw.entries.map(migrateEntryV2toV3) : [];
  return { ...raw, version: 3, entries };
}

/* v3 → v4: قرص، محتوای تحریک‌آمیز و لاگ غذا اضافه می‌شوند (همه «ثبت‌نشده») */
function migrateEntryV3toV4(e) {
  const dateKey = isObj(e) && typeof e.date === "string" && DATE_KEY_RE.test(e.date)
    ? e.date
    : "1970-01-01";
  const base = createCheckinEntry(dateKey);
  const food = isObj(e?.food) ? e.food : {};
  return {
    ...base,
    ...e,
    medication: isObj(e?.medication) ? e.medication : emptyMedication(),
    explicit: isObj(e?.explicit) ? e.explicit : emptyExplicit(),
    food: {
      ...base.food,
      ...food,
      log: isObj(food.log) ? food.log : emptyFoodLog(),
      other: typeof food.other === "string" ? food.other : null,
      logged: typeof food.logged === "boolean" ? food.logged : false,
    },
  };
}

function migrateV3toV4(raw) {
  const entries = Array.isArray(raw.entries) ? raw.entries.map(migrateEntryV3toV4) : [];
  return { ...raw, version: 4, entries };
}

/* ---------- serialization ---------- */

export function serializeCheckinDocument(doc, nowMs = Date.now()) {
  const out = { ...doc, updatedAt: new Date(nowMs).toISOString() };
  return JSON.stringify(out, null, 2) + "\n";
}

export function parseCheckinDocument(text) {
  let raw;
  try { raw = JSON.parse(text); }
  catch { throw new CheckinDataError(INVALID_CHECKIN_MESSAGE, ["File is not valid JSON"]); }
  if (!isObj(raw)) throw new CheckinDataError(INVALID_CHECKIN_MESSAGE, ["Root must be a JSON object"]);

  // migrate if needed (v1 → v2 → v3 → v4)
  let v = Number(raw.version);
  if (v === 1) { raw = migrateV1toV2(raw); v = 2; }
  if (v === 2) { raw = migrateV2toV3(raw); v = 3; }
  if (v === 3) raw = migrateV3toV4(raw);

  const doc = {
    ...createEmptyCheckinDocument(),
    ...raw,
    version: CHECKIN_SCHEMA_VERSION,
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
  doc.entries.sort((a, b) => (a.date < b.date ? 1 : -1));
  return doc;
}