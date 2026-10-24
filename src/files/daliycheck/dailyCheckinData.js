/* =============================================================
   dailyCheckinData.js — pure data model for daily-checkins.json
   Schema v6: analytics-ready. Adds responseMeta, interventions,
   physical/social/events/circadian, ADHD effect+side effects,
   richer sleep/food, reframed masturbation, exercise type/intensity,
   composite scores, cross-field validation.
   ============================================================= */

export const CHECKIN_SCHEMA_VERSION = 6;
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
const MAX_ITEMS = 50;
const MAX_FOOD_PER_MEAL = 40;
const MAX_TAGS = 12;

export const EXERCISE_TYPES = [
  "taekwondo", "bjj", "walking", "cardio", "strength", "yoga", "sports", "other",
];
export const EXERCISE_INTENSITIES = ["light", "moderate", "vigorous"];
export const EXERCISE_TIMES = ["morning", "afternoon", "evening"];
export const MAST_CONTEXTS = ["stress", "boredom", "habit", "choice", "other"];
export const EXPLICIT_DRIVERS = ["choice", "urge"];
export const EXPLICIT_CONTEXTS = ["stress", "boredom", "habit", "choice", "other"];
export const MED_SIDE_EFFECTS = [
  "appetite_loss", "insomnia", "jitteriness", "crash", "headache", "dry_mouth", "irritability", "other",
];
export const EVENT_TAGS = [
  "conflict", "deadline", "health", "money", "family", "work", "social", "romantic", "other",
];
export const INTERVENTION_TYPES = ["supplement", "habit", "medication", "behavioral", "diet", "other"];
export const PHASE_TYPES = ["baseline", "washout", "treatment"];

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const isInt = (v) => Number.isInteger(v);
const isNum = (v) => typeof v === "number" && Number.isFinite(v);
const isScore = (v) => isNum(v) && v >= 1 && v <= 10;          // derived composites (1-10)
const isLikert5 = (v) => isInt(v) && v >= 1 && v <= 5;         // raw items
const isSeverity = (v) => isInt(v) && v >= 0 && v <= 3;        // 0-3 severity
const isVas10 = (v) => isNum(v) && v >= 0 && v <= 10;          // 0-10 VAS

export class CheckinDataError extends Error {
  constructor(message, details = []) {
    super(message);
    this.name = "CheckinDataError";
    this.details = details;
  }
}

/* ---------- default factories ---------- */

const emptySlots = () => ({ morning: null, evening: null });
const emptyResponseMeta = () => ({ morning: null, evening: null });
const emptyResponseMetaEntry = () => ({
  startedAt: null,
  completedAt: null,
  durationMs: null,
  itemsAnswered: null,
  itemsSkipped: null,
});
const emptySleep = () => ({
  bedTime: null, wakeTime: null, hours: null,
  latencyMin: null, awakenings: null, quality: null, restedness: null,
  napsMin: null, lastCaffeineTime: null, screenBeforeBedMin: null,
});
const emptyRoutine = () => ({ done: false, steps: null, effectiveness: null });
const emptyMorningState = () => ({ mood: null, energy: null, tension: null });
const emptyMood = () => ({ rating: null, stress: null, energy: null, focus: null, anxiety: null });
const emptyPhysical = () => ({ headache: null, bodyPain: null, fatigueBeyond: null, digestive: null });
const emptySocial = () => ({ meaningfulContact: null, loneliness: null });
const emptyEvents = () => ({ stressorCount: null, tags: [] });
const emptyCircadian = () => ({ morningOutdoorLight: null, eveningBrightLight: null });
const emptyFoodLog = () => ({ breakfast: [], lunch: [], dinner: [], snack: [] });
const emptyFood = () => ({
  meals: null, quality: null,
  water: false, waterGlasses: null,
  caffeine: null, caffeineCups: null, caffeineLastTime: null,
  sugarEpisodes: null, firstMealTime: null, lastMealTime: null,
  log: emptyFoodLog(), other: null, logged: false,
});
const emptyDose = () => ({ taken: false, amount: null, time: null, effect: null, sideEffects: [] });
const emptyMedication = () => ({ recorded: false, morning: emptyDose(), afternoon: emptyDose() });
const emptyMast = () => ({
  recorded: false, done: false, count: null,
  urgeIntensity: null, guilt: null, context: null,
});
const emptyExplicit = () => ({
  recorded: false, viewed: false, minutes: null,
  driver: null, regret: null, context: null,
});
const emptyExercise = () => ({
  done: false, minutes: null, recorded: false,
  type: null, intensity: null, timeOfDay: null,
});
const emptyScores = () => ({
  sleepHealth: null, moodIndex: null, anxietyIndex: null, energyIndex: null,
  focusIndex: null, adherenceScore: null, nutritionScore: null, recoveryScore: null,
  adhdIndex: null,
});

/* ---------- date helpers ---------- */

export function localDateKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

export function prevDateKey(dateKey) {
  const [y, m, d] = dateKey.split("-").map(Number);
  return localDateKey(new Date(y, m - 1, d - 1, 12));
}

/* ---------- doc / entry factories ---------- */

export function createEmptyCheckinDocument(nowMs = Date.now()) {
  const iso = new Date(nowMs).toISOString();
  return {
    schemaVersion: CHECKIN_DATA_FORMAT,
    version: CHECKIN_SCHEMA_VERSION,
    app: "Study Timer",
    createdAt: iso,
    updatedAt: iso,
    entries: [],
    interventions: [],
    phases: [],
    itemRegistry: {},
  };
}

export function createCheckinEntry(dateKey, nowMs = Date.now()) {
  return {
    date: dateKey,
    slots: emptySlots(),
    responseMeta: emptyResponseMeta(),
    travel: null,
    sleep: emptySleep(),
    relaxationRoutine: emptyRoutine(),
    medication: emptyMedication(),
    morningState: emptyMorningState(),
    mood: emptyMood(),
    physical: emptyPhysical(),
    social: emptySocial(),
    events: emptyEvents(),
    circadian: emptyCircadian(),
    items: {},
    activity1: null,
    operation1: null,
    masturbation: emptyMast(),
    explicit: emptyExplicit(),
    food: emptyFood(),
    dayRating: null,
    yesterdayQuality: null, // legacy (v1/v2)
    exercise: emptyExercise(),
    scores: emptyScores(),
    notes: null,
    recordedAt: new Date(nowMs).toISOString(),
  };
}

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

/* ---------- sleep-hours (shared with modal) ---------- */

export function computeSleepHours(bedTime, wakeTime) {
  if (!bedTime || !wakeTime) return null;
  const [bh, bm] = bedTime.split(":").map(Number);
  const [wh, wm] = wakeTime.split(":").map(Number);
  if (![bh, bm, wh, wm].every(Number.isFinite)) return null;
  let bedMin = bh * 60 + bm;
  let wakeMin = wh * 60 + wm;
  if (wakeMin <= bedMin) wakeMin += 24 * 60;
  return Math.round(((wakeMin - bedMin) / 60) * 10) / 10;
}

/* ---------- composite scores ---------- */

/**
 * Returns derived scores (0-100). Called on save & import.
 * All formulas documented in-place. Null when insufficient input.
 */
export function computeDailyScores(entry) {
  const s = entry.sleep || {};
  const m = entry.mood || {};
  const f = entry.food || {};
  const md = entry.medication || {};
  const ph = entry.physical || {};
  const it = entry.items || {};

  const num = (v) => (typeof v === "number" && Number.isFinite(v) ? v : null);
  const avg = (arr) => {
    const vals = arr.filter((v) => v != null);
    return vals.length ? vals.reduce((a, b) => a + b, 0) / vals.length : null;
  };

  // sleepHealth: ideal 7–9h, penalize latency >15m, awakenings
  const sleepParts = [];
  if (num(s.hours) != null) {
    const h = s.hours;
    const penalty = h < 7 ? (7 - h) * 15 : h > 9 ? (h - 9) * 12 : 0;
    sleepParts.push(Math.max(0, 100 - penalty));
  }
  if (num(s.quality) != null) sleepParts.push(((s.quality - 1) / 9) * 100);
  if (num(s.restedness) != null) sleepParts.push(((s.restedness - 1) / 9) * 100);
  if (num(s.latencyMin) != null) sleepParts.push(Math.max(0, 100 - Math.max(0, s.latencyMin - 15) * 1.5));
  if (num(s.awakenings) != null) sleepParts.push(Math.max(0, 100 - s.awakenings * 15));
  const sleepHealth = sleepParts.length ? Math.round(avg(sleepParts)) : null;

  const moodIndex = num(m.rating) != null ? Math.round(((m.rating - 1) / 9) * 100) : null;
  const anxietyIndex = num(m.anxiety) != null ? Math.round(100 - ((m.anxiety - 1) / 9) * 100) : null;
  const energyIndex = num(m.energy) != null ? Math.round(((m.energy - 1) / 9) * 100) : null;

  // focusIndex: mood.focus (1-10) + items.focusQuality (1-5)
  const focusParts = [];
  if (num(m.focus) != null) focusParts.push(((m.focus - 1) / 9) * 100);
  if (num(it.focusQuality) != null) focusParts.push(((it.focusQuality - 1) / 4) * 100);
  const focusIndex = focusParts.length ? Math.round(avg(focusParts)) : null;

  // adhdIndex: combined ADHD-impact (focusQuality + 6-taskProcrastination + 6-emotionalDysregulation)
  const adhdParts = [];
  if (num(it.focusQuality) != null) adhdParts.push(((it.focusQuality - 1) / 4) * 100);
  if (num(it.taskProcrastination) != null) adhdParts.push((1 - (it.taskProcrastination - 1) / 4) * 100);
  if (num(it.emotionalDysregulation) != null) adhdParts.push((1 - (it.emotionalDysregulation - 1) / 4) * 100);
  const adhdIndex = adhdParts.length ? Math.round(avg(adhdParts)) : null;

  // adherenceScore
  const doses = [md.morning, md.afternoon].filter(Boolean);
  const taken = doses.filter((d) => d.taken).length;
  const adherenceScore = doses.length ? Math.round((taken / doses.length) * 100) : null;

  // nutritionScore: quality (1-10), -sugar, +veg (veg optional)
  const nutriParts = [];
  if (num(f.quality) != null) nutriParts.push(((f.quality - 1) / 9) * 100);
  if (num(f.sugarEpisodes) != null) nutriParts.push(Math.max(0, 100 - f.sugarEpisodes * 15));
  const nutritionScore = nutriParts.length ? Math.round(avg(nutriParts)) : null;

  // recoveryScore: sleep + low fatigue + low stress
  const recParts = [];
  if (sleepHealth != null) recParts.push(sleepHealth);
  if (num(ph.fatigueBeyond) != null) recParts.push(100 - (ph.fatigueBeyond / 3) * 100);
  if (num(m.stress) != null) recParts.push(100 - ((m.stress - 1) / 9) * 100);
  const recoveryScore = recParts.length ? Math.round(avg(recParts)) : null;

  return {
    sleepHealth, moodIndex, anxietyIndex, energyIndex,
    focusIndex, adherenceScore, nutritionScore, recoveryScore, adhdIndex,
  };
}

/* ---------- validation ---------- */

function validateEntry(entry, index, seenDates, err) {
  const p = `entries[${index}]`;
  if (!isObj(entry)) return err(`${p} must be an object`);

  const score = (path, v) => { if (v !== null && !isScore(v)) err(`${path} must be null or 1–10`); };
  const intIn = (path, v, lo, hi) => {
    if (v !== null && (!isInt(v) || v < lo || v > hi)) err(`${path} must be null or int ${lo}–${hi}`);
  };
  const sev = (path, v) => { if (v !== null && !isSeverity(v)) err(`${path} must be null or 0–3`); };
  const vas = (path, v) => { if (v !== null && !isVas10(v)) err(`${path} must be null or 0–10`); };
  const l5 = (path, v) => { if (v !== null && !isLikert5(v)) err(`${path} must be null or int 1–5`); };

  // date
  if (typeof entry.date !== "string" || !DATE_KEY_RE.test(entry.date)) {
    err(`${p}.date must be a "YYYY-MM-DD" date`);
  } else if (seenDates.has(entry.date)) {
    err(`${p}.date "${entry.date}" is duplicated`);
  } else {
    seenDates.add(entry.date);
  }

  // slots
  if (!isObj(entry.slots)) err(`${p}.slots must be an object`);
  else for (const k of ["morning", "evening"]) {
    const v = entry.slots[k];
    if (v !== null && (typeof v !== "string" || Number.isNaN(Date.parse(v)))) {
      err(`${p}.slots.${k} must be null or ISO 8601`);
    }
  }

  // responseMeta
  if (!isObj(entry.responseMeta)) err(`${p}.responseMeta must be an object`);
  else for (const k of ["morning", "evening"]) {
    const r = entry.responseMeta[k];
    if (r === null) continue;
    if (!isObj(r)) { err(`${p}.responseMeta.${k} must be null or object`); continue; }
    if (r.startedAt !== null && Number.isNaN(Date.parse(r.startedAt))) err(`${p}.responseMeta.${k}.startedAt invalid`);
    if (r.completedAt !== null && Number.isNaN(Date.parse(r.completedAt))) err(`${p}.responseMeta.${k}.completedAt invalid`);
    intIn(`${p}.responseMeta.${k}.durationMs`, r.durationMs, 0, 3600000);
    intIn(`${p}.responseMeta.${k}.itemsAnswered`, r.itemsAnswered, 0, 1000);
    intIn(`${p}.responseMeta.${k}.itemsSkipped`, r.itemsSkipped, 0, 1000);
  }

  // travel
  if (entry.travel !== null && typeof entry.travel !== "boolean") err(`${p}.travel must be null or boolean`);

  // sleep
  if (!isObj(entry.sleep)) err(`${p}.sleep must be an object`);
  else {
    const s = entry.sleep;
    if (s.bedTime !== null && !TIME_RE.test(s.bedTime)) err(`${p}.sleep.bedTime must be null or "HH:MM"`);
    if (s.wakeTime !== null && !TIME_RE.test(s.wakeTime)) err(`${p}.sleep.wakeTime must be null or "HH:MM"`);
    if (s.hours !== null && (!isNum(s.hours) || s.hours < 0 || s.hours > 24)) err(`${p}.sleep.hours out of range`);
    intIn(`${p}.sleep.latencyMin`, s.latencyMin, 0, 600);
    intIn(`${p}.sleep.awakenings`, s.awakenings, 0, 20);
    intIn(`${p}.sleep.napsMin`, s.napsMin, 0, 300);
    intIn(`${p}.sleep.screenBeforeBedMin`, s.screenBeforeBedMin, 0, 300);
    if (s.lastCaffeineTime !== null && !TIME_RE.test(s.lastCaffeineTime)) err(`${p}.sleep.lastCaffeineTime invalid`);
    score(`${p}.sleep.quality`, s.quality);
    score(`${p}.sleep.restedness`, s.restedness);

    // cross-field: hours vs bed/wake
    if (s.bedTime && s.wakeTime && s.hours != null) {
      const c = computeSleepHours(s.bedTime, s.wakeTime);
      if (c != null && Math.abs(c - s.hours) > 1.5) {
        err(`${p}.sleep.hours (${s.hours}) inconsistent with bedTime/wakeTime (${c})`);
      }
    }
  }

  // relaxationRoutine
  if (!isObj(entry.relaxationRoutine)) err(`${p}.relaxationRoutine must be an object`);
  else {
    const r = entry.relaxationRoutine;
    if (typeof r.done !== "boolean") err(`${p}.relaxationRoutine.done must be boolean`);
    intIn(`${p}.relaxationRoutine.steps`, r.steps, 0, 100);
    score(`${p}.relaxationRoutine.effectiveness`, r.effectiveness);
  }

  // medication
  if (!isObj(entry.medication)) err(`${p}.medication must be an object`);
  else {
    const md = entry.medication;
    if (typeof md.recorded !== "boolean") err(`${p}.medication.recorded must be boolean`);
    for (const k of ["morning", "afternoon"]) {
      const d = md[k];
      if (!isObj(d)) { err(`${p}.medication.${k} must be object`); continue; }
      if (typeof d.taken !== "boolean") err(`${p}.medication.${k}.taken must be boolean`);
      if (d.amount !== null && (!isNum(d.amount) || d.amount <= 0 || d.amount > 4)) err(`${p}.medication.${k}.amount out of range`);
      if (d.time !== null && !TIME_RE.test(d.time)) err(`${p}.medication.${k}.time invalid`);
      vas(`${p}.medication.${k}.effect`, d.effect);
      if (!Array.isArray(d.sideEffects) || d.sideEffects.some((x) => !MED_SIDE_EFFECTS.includes(x))) {
        err(`${p}.medication.${k}.sideEffects must be array of known side effects`);
      }
      // cross-field: if not taken, effect/amount/time must be null
      if (d.taken === false && (d.amount != null || d.time != null || d.effect != null)) {
        err(`${p}.medication.${k}: not taken but amount/time/effect set`);
      }
    }
    if (md.recorded === false && (md.morning.taken || md.afternoon.taken)) {
      err(`${p}.medication: recorded=false but taken=true`);
    }
  }

  // morningState
  if (!isObj(entry.morningState)) err(`${p}.morningState must be object`);
  else for (const k of ["mood", "energy", "tension"]) score(`${p}.morningState.${k}`, entry.morningState[k]);

  // mood composites
  if (!isObj(entry.mood)) err(`${p}.mood must be object`);
  else for (const k of ["rating", "stress", "energy", "focus", "anxiety"]) score(`${p}.mood.${k}`, entry.mood[k]);

  // physical
  if (!isObj(entry.physical)) err(`${p}.physical must be object`);
  else for (const k of ["headache", "bodyPain", "fatigueBeyond", "digestive"]) sev(`${p}.physical.${k}`, entry.physical[k]);

  // social
  if (!isObj(entry.social)) err(`${p}.social must be object`);
  else {
    if (entry.social.meaningfulContact !== null && typeof entry.social.meaningfulContact !== "boolean") {
      err(`${p}.social.meaningfulContact must be null or boolean`);
    }
    l5(`${p}.social.loneliness`, entry.social.loneliness);
  }

  // events
  if (!isObj(entry.events)) err(`${p}.events must be object`);
  else {
    intIn(`${p}.events.stressorCount`, entry.events.stressorCount, 0, 3);
    if (!Array.isArray(entry.events.tags)) err(`${p}.events.tags must be array`);
    else {
      if (entry.events.tags.length > MAX_TAGS) err(`${p}.events.tags > ${MAX_TAGS}`);
      if (entry.events.tags.some((t) => !EVENT_TAGS.includes(t))) err(`${p}.events.tags has unknown tag`);
    }
  }

  // circadian
  if (!isObj(entry.circadian)) err(`${p}.circadian must be object`);
  else {
    intIn(`${p}.circadian.morningOutdoorLight`, entry.circadian.morningOutdoorLight, 0, 180);
    if (entry.circadian.eveningBrightLight !== null && typeof entry.circadian.eveningBrightLight !== "boolean") {
      err(`${p}.circadian.eveningBrightLight must be null or boolean`);
    }
  }

  // items (raw Likert 1-5)
  if (!isObj(entry.items)) err(`${p}.items must be object`);
  else {
    const keys = Object.keys(entry.items);
    if (keys.length > MAX_ITEMS) err(`${p}.items > ${MAX_ITEMS} keys`);
    for (const k of keys) l5(`${p}.items.${k}`, entry.items[k]);
  }

  if (entry.activity1 !== null && typeof entry.activity1 !== "boolean") err(`${p}.activity1 must be null or boolean`);
  if (entry.operation1 !== null && typeof entry.operation1 !== "boolean") err(`${p}.operation1 must be null or boolean`);

  // masturbation (reframed)
  if (!isObj(entry.masturbation)) err(`${p}.masturbation must be object`);
  else {
    const m = entry.masturbation;
    if (typeof m.recorded !== "boolean") err(`${p}.masturbation.recorded must be boolean`);
    if (typeof m.done !== "boolean") err(`${p}.masturbation.done must be boolean`);
    intIn(`${p}.masturbation.count`, m.count, 0, 20);
    intIn(`${p}.masturbation.urgeIntensity`, m.urgeIntensity, 0, 5);
    intIn(`${p}.masturbation.guilt`, m.guilt, 0, 5);
    if (m.context !== null && !MAST_CONTEXTS.includes(m.context)) err(`${p}.masturbation.context invalid`);
    if (m.done === false && m.count != null) err(`${p}.masturbation.count set but done=false`);
  }

  // explicit
  if (!isObj(entry.explicit)) err(`${p}.explicit must be object`);
  else {
    const x = entry.explicit;
    if (typeof x.recorded !== "boolean") err(`${p}.explicit.recorded must be boolean`);
    if (typeof x.viewed !== "boolean") err(`${p}.explicit.viewed must be boolean`);
    intIn(`${p}.explicit.minutes`, x.minutes, 0, 1440);
    if (x.driver !== null && !EXPLICIT_DRIVERS.includes(x.driver)) err(`${p}.explicit.driver invalid`);
    if (x.context !== null && !EXPLICIT_CONTEXTS.includes(x.context)) err(`${p}.explicit.context invalid`);
    intIn(`${p}.explicit.regret`, x.regret, 0, 5);
    if (x.viewed === false && (x.minutes != null || x.driver != null)) {
      err(`${p}.explicit: viewed=false but minutes/driver set`);
    }
  }

  // food
  if (!isObj(entry.food)) err(`${p}.food must be object`);
  else {
    const f = entry.food;
    intIn(`${p}.food.meals`, f.meals, 0, 10);
    score(`${p}.food.quality`, f.quality);
    if (typeof f.water !== "boolean") err(`${p}.food.water must be boolean`);
    intIn(`${p}.food.waterGlasses`, f.waterGlasses, 0, 15);
    intIn(`${p}.food.caffeine`, f.caffeine, 0, 20);
    intIn(`${p}.food.caffeineCups`, f.caffeineCups, 0, 10);
    if (f.caffeineLastTime !== null && !TIME_RE.test(f.caffeineLastTime)) err(`${p}.food.caffeineLastTime invalid`);
    intIn(`${p}.food.sugarEpisodes`, f.sugarEpisodes, 0, 10);
    if (f.firstMealTime !== null && !TIME_RE.test(f.firstMealTime)) err(`${p}.food.firstMealTime invalid`);
    if (f.lastMealTime !== null && !TIME_RE.test(f.lastMealTime)) err(`${p}.food.lastMealTime invalid`);
    if (typeof f.logged !== "boolean") err(`${p}.food.logged must be boolean`);
    if (f.other !== null && (typeof f.other !== "string" || f.other.length > MAX_OTHER_FOOD_LEN)) err(`${p}.food.other invalid`);
    if (!isObj(f.log)) err(`${p}.food.log must be object`);
    else for (const m of MEAL_KEYS) {
      const arr = f.log[m];
      if (!Array.isArray(arr) || arr.length > MAX_FOOD_PER_MEAL) err(`${p}.food.log.${m} invalid length`);
      else if (arr.some((id) => typeof id !== "string" || !FOOD_ID_RE.test(id))) err(`${p}.food.log.${m} invalid id`);
    }
  }

  score(`${p}.dayRating`, entry.dayRating);
  score(`${p}.yesterdayQuality`, entry.yesterdayQuality);

  // exercise
  if (!isObj(entry.exercise)) err(`${p}.exercise must be object`);
  else {
    const e = entry.exercise;
    if (typeof e.done !== "boolean") err(`${p}.exercise.done must be boolean`);
    if (typeof e.recorded !== "boolean") err(`${p}.exercise.recorded must be boolean`);
    intIn(`${p}.exercise.minutes`, e.minutes, 0, 600);
    if (e.type !== null && !EXERCISE_TYPES.includes(e.type)) err(`${p}.exercise.type invalid`);
    if (e.intensity !== null && !EXERCISE_INTENSITIES.includes(e.intensity)) err(`${p}.exercise.intensity invalid`);
    if (e.timeOfDay !== null && !EXERCISE_TIMES.includes(e.timeOfDay)) err(`${p}.exercise.timeOfDay invalid`);
    if (e.done === false && (e.minutes != null || e.type != null)) {
      err(`${p}.exercise: done=false but minutes/type set`);
    }
  }

  // notes
  if (entry.notes !== null && typeof entry.notes !== "string") err(`${p}.notes must be null or string`);
  else if (typeof entry.notes === "string" && entry.notes.length > MAX_NOTES_LEN) err(`${p}.notes > ${MAX_NOTES_LEN}`);

  if (typeof entry.recordedAt !== "string" || Number.isNaN(Date.parse(entry.recordedAt))) {
    err(`${p}.recordedAt must be ISO 8601`);
  }

  // scores (derived): allow null
  if (entry.scores != null && !isObj(entry.scores)) err(`${p}.scores must be null or object`);
}

export function validateCheckinDocument(doc) {
  const errors = [];
  const err = (m) => { if (errors.length < 30) errors.push(m); };

  if (!isObj(doc)) { err("Root must be a JSON object"); return errors; }
  if (doc.schemaVersion !== CHECKIN_DATA_FORMAT) err(`schemaVersion must be "${CHECKIN_DATA_FORMAT}"`);
  if (doc.version !== CHECKIN_SCHEMA_VERSION) err(`version must be ${CHECKIN_SCHEMA_VERSION}`);

  if (!Array.isArray(doc.interventions)) err("interventions must be array");
  else for (let i = 0; i < doc.interventions.length; i++) {
    const it = doc.interventions[i];
    if (!isObj(it)) { err(`interventions[${i}] must be object`); continue; }
    if (typeof it.id !== "string" || !it.id) err(`interventions[${i}].id required`);
    if (typeof it.name !== "string" || !it.name) err(`interventions[${i}].name required`);
    if (!INTERVENTION_TYPES.includes(it.type)) err(`interventions[${i}].type invalid`);
    if (typeof it.startedAt !== "string" || !DATE_KEY_RE.test(it.startedAt)) err(`interventions[${i}].startedAt must be YYYY-MM-DD`);
    if (it.endedAt !== null && (typeof it.endedAt !== "string" || !DATE_KEY_RE.test(it.endedAt))) err(`interventions[${i}].endedAt invalid`);
  }

  if (!Array.isArray(doc.phases)) err("phases must be array");
  else for (let i = 0; i < doc.phases.length; i++) {
    const ph = doc.phases[i];
    if (!isObj(ph)) { err(`phases[${i}] must be object`); continue; }
    if (typeof ph.startDate !== "string" || !DATE_KEY_RE.test(ph.startDate)) err(`phases[${i}].startDate invalid`);
    if (ph.endDate !== null && (typeof ph.endDate !== "string" || !DATE_KEY_RE.test(ph.endDate))) err(`phases[${i}].endDate invalid`);
    if (!PHASE_TYPES.includes(ph.type)) err(`phases[${i}].type invalid`);
  }

  if (!isObj(doc.itemRegistry)) err("itemRegistry must be object");

  if (!Array.isArray(doc.entries)) err("entries must be array");
  else {
    if (doc.entries.length > MAX_ENTRIES) err(`entries > ${MAX_ENTRIES}`);
    const seen = new Set();
    doc.entries.forEach((e, i) => validateEntry(e, i, seen, err));
  }
  return errors;
}

/* ---------- migrations ---------- */

// (v1→v2→v3→v4→v5 unchanged — copy existing functions verbatim)

function migrateEntryV1toV2(e) {
  const dateKey = isObj(e) && typeof e.date === "string" && DATE_KEY_RE.test(e.date) ? e.date : "1970-01-01";
  const base = createCheckinEntry(dateKey);
  return {
    ...base, ...e,
    sleep: { ...base.sleep, ...(isObj(e?.sleep) ? e.sleep : {}) },
    relaxationRoutine: { ...base.relaxationRoutine, ...(isObj(e?.relaxationRoutine) ? e.relaxationRoutine : {}), effectiveness: null },
    mood: { ...base.mood }, masturbation: emptyMast(), food: emptyFood(), notes: null,
  };
}
function migrateV1toV2(raw) {
  return { ...raw, version: 2, entries: Array.isArray(raw.entries) ? raw.entries.map(migrateEntryV1toV2) : [] };
}
function migrateEntryV2toV3(e) {
  const dateKey = isObj(e) && typeof e.date === "string" && DATE_KEY_RE.test(e.date) ? e.date : "1970-01-01";
  const base = createCheckinEntry(dateKey);
  const stamp = typeof e?.recordedAt === "string" ? e.recordedAt : base.recordedAt;
  return {
    ...base, ...e, slots: { morning: stamp, evening: stamp },
    sleep: { ...base.sleep, ...(isObj(e?.sleep) ? e.sleep : {}) },
    relaxationRoutine: { ...base.relaxationRoutine, ...(isObj(e?.relaxationRoutine) ? e.relaxationRoutine : {}) },
    morningState: emptyMorningState(),
    mood: { ...base.mood, ...(isObj(e?.mood) ? e.mood : {}) },
    items: {}, food: { ...base.food, ...(isObj(e?.food) ? e.food : {}) }, dayRating: null,
  };
}
function migrateV2toV3(raw) {
  return { ...raw, version: 3, entries: Array.isArray(raw.entries) ? raw.entries.map(migrateEntryV2toV3) : [] };
}
function migrateEntryV3toV4(e) {
  const dateKey = isObj(e) && typeof e.date === "string" && DATE_KEY_RE.test(e.date) ? e.date : "1970-01-01";
  const base = createCheckinEntry(dateKey);
  const food = isObj(e?.food) ? e.food : {};
  return {
    ...base, ...e,
    medication: isObj(e?.medication) ? e.medication : emptyMedication(),
    explicit: isObj(e?.explicit) ? e.explicit : emptyExplicit(),
    food: { ...base.food, ...food, log: isObj(food.log) ? food.log : emptyFoodLog(),
      other: typeof food.other === "string" ? food.other : null,
      logged: typeof food.logged === "boolean" ? food.logged : false },
  };
}
function migrateV3toV4(raw) {
  return { ...raw, version: 4, entries: Array.isArray(raw.entries) ? raw.entries.map(migrateEntryV3toV4) : [] };
}
function migrateEntryV4toV5(e) {
  const dateKey = isObj(e) && typeof e.date === "string" && DATE_KEY_RE.test(e.date) ? e.date : "1970-01-01";
  const base = createCheckinEntry(dateKey);
  const ex = isObj(e?.exercise) ? e.exercise : {};
  return {
    ...base, ...e,
    travel: typeof e?.travel === "boolean" ? e.travel : null,
    exercise: {
      done: typeof ex.done === "boolean" ? ex.done : false,
      minutes: ex.minutes ?? null,
      recorded: typeof ex.recorded === "boolean" ? ex.recorded : !!e?.slots?.evening,
    },
  };
}
function migrateV4toV5(raw) {
  return { ...raw, version: 5, entries: Array.isArray(raw.entries) ? raw.entries.map(migrateEntryV4toV5) : [] };
}

/* v5 → v6: extensive additive migration + masturbation reframe */
function migrateEntryV5toV6(e) {
  const dateKey = isObj(e) && typeof e.date === "string" && DATE_KEY_RE.test(e.date) ? e.date : "1970-01-01";
  const base = createCheckinEntry(dateKey);

  // masturbation: {positive, negative} → {recorded, done, count, urgeIntensity, guilt, context}
  const oldMast = isObj(e?.masturbation) ? e.masturbation : {};
  const pos = isObj(oldMast.positive) ? oldMast.positive : {};
  const neg = isObj(oldMast.negative) ? oldMast.negative : {};
  const wasDone = !!(pos.done || neg.done);
  const oldCount = (pos.count || 0) + (neg.count || 0);
  const mast = {
    recorded: wasDone,
    done: wasDone,
    count: wasDone ? oldCount : null,
    urgeIntensity: null,
    guilt: null,
    context: neg.done ? "stress" : pos.done ? "choice" : null,
  };

  // food
  const oldFood = isObj(e?.food) ? e.food : {};
  const oldWater = oldFood.water === true;
  const oldCaffeine = typeof oldFood.caffeine === "number" ? oldFood.caffeine : null;

  // exercise
  const oldEx = isObj(e?.exercise) ? e.exercise : {};

  return {
    ...base, ...e,
    responseMeta: { morning: null, evening: null },
    sleep: {
      ...(isObj(e.sleep) ? e.sleep : {}),
      napsMin: null, lastCaffeineTime: null, screenBeforeBedMin: null,
    },
    medication: {
      recorded: e?.medication?.recorded ?? false,
      morning: { ...emptyDose(), ...(e?.medication?.morning || {}), effect: null, sideEffects: [] },
      afternoon: { ...emptyDose(), ...(e?.medication?.afternoon || {}), effect: null, sideEffects: [] },
    },
    physical: emptyPhysical(),
    social: emptySocial(),
    events: emptyEvents(),
    circadian: emptyCircadian(),
    masturbation: mast,
    explicit: { ...(isObj(e.explicit) ? e.explicit : {}), regret: null, context: null },
    food: {
      ...(isObj(e.food) ? e.food : {}),
      water: oldWater, waterGlasses: oldWater ? 8 : null,
      caffeine: oldCaffeine, caffeineCups: oldCaffeine, caffeineLastTime: null,
      sugarEpisodes: null, firstMealTime: null, lastMealTime: null,
    },
    exercise: {
      done: typeof oldEx.done === "boolean" ? oldEx.done : false,
      minutes: oldEx.minutes ?? null,
      recorded: typeof oldEx.recorded === "boolean" ? oldEx.recorded : false,
      type: null, intensity: null, timeOfDay: null,
    },
    scores: null,
  };
}

function migrateV5toV6(raw) {
  const base = createEmptyCheckinDocument();
  return {
    ...base, ...raw,
    version: 6,
    entries: Array.isArray(raw.entries) ? raw.entries.map(migrateEntryV5toV6) : [],
    interventions: Array.isArray(raw.interventions) ? raw.interventions : [],
    phases: Array.isArray(raw.phases) ? raw.phases : [],
    itemRegistry: isObj(raw.itemRegistry) ? raw.itemRegistry : {},
  };
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

  let v = Number(raw.version);
  if (v === 1) { raw = migrateV1toV2(raw); v = 2; }
  if (v === 2) { raw = migrateV2toV3(raw); v = 3; }
  if (v === 3) { raw = migrateV3toV4(raw); v = 4; }
  if (v === 4) { raw = migrateV4toV5(raw); v = 5; }
  if (v === 5) raw = migrateV5toV6(raw);

  const doc = {
    ...createEmptyCheckinDocument(),
    ...raw,
    version: CHECKIN_SCHEMA_VERSION,
    entries: Array.isArray(raw.entries) ? raw.entries : [],
  };

  // Recompute scores for every entry (source of truth)
  for (const e of doc.entries) e.scores = computeDailyScores(e);

  const errors = validateCheckinDocument(doc);
  if (errors.length) throw new CheckinDataError(INVALID_CHECKIN_MESSAGE, errors);
  return doc;
}

/* ---------- lookup & mutation ---------- */

export function findEntryByDate(doc, dateKey) {
  return doc.entries.find((e) => e.date === dateKey) || null;
}

export function upsertEntry(doc, entry) {
  entry.scores = computeDailyScores(entry);
  const idx = doc.entries.findIndex((e) => e.date === entry.date);
  if (idx === -1) doc.entries.push(entry);
  else doc.entries[idx] = entry;
  doc.entries.sort((a, b) => (a.date < b.date ? 1 : -1));
  return doc;
}