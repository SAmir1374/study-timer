/* =============================================================
   checkin-analytics.js — v6
   Schema v6: physical, social, events, circadian, wellbeing/ADHD
   items, medication effect & side effects, exercise type/intensity/
   time, richer sleep/food, reframed masturbation, precomputed
   composite scores, responseMeta, interventions & phases.
   ============================================================= */

import {
  parseCheckinDocument,
  CheckinDataError,
  INTERVENTION_TYPES,
} from "./dailyCheckinData.js";
import { MEALS, foodTags, foodLabel } from "./foodCatalog.js";
import { FileStorage } from "../fileStorage.js";

const LOCAL_BACKUP_KEY = "study-timer:daily-checkins-backup";
const HANDLE_KEY = "study-timer:daily-checkins-handle";

/* ---------- تنظیمات الگوریتم ---------- */
const DAY_MS = 86400000;
const RECENT_DAYS = 7;
const BASELINE_DAYS = 35;
const BASELINE_MIN_RECENT = 4;
const BASELINE_MIN_BASE = 14;
const SD_FLOOR = 0.7;
const DEV_WARN = 0.8;
const DEV_DANGER = 1.3;
const MIN_COVERAGE_7 = 5;
const TRAVEL_NOTE_DAYS = 3;
const MIN_CORR_N = 20;
const CORR_SIG_K = 2.5;
const CORR_SHOW = 22;
const MIN_GROUP_N = 5;
const SIG_T = 2.5;
const SIG_MIN_N = 8;

const BASELINE_METRICS = [
  { key: "score",        label: "امتیاز روانی کلی", bad: "low" },
  { key: "mood",         label: "خلق",              bad: "low" },
  { key: "stress",       label: "استرس",            bad: "high" },
  { key: "anxiety",      label: "اضطراب",           bad: "high" },
  { key: "focus",        label: "تمرکز",            bad: "low" },
  { key: "energy",       label: "انرژی",            bad: "low" },
  { key: "sleepHours",   label: "ساعت خواب",        bad: "low" },
  { key: "sleepQuality", label: "کیفیت خواب",       bad: "low" },
  { key: "sleepLatency", label: "زمان به خواب رفتن", bad: "high", floor: 8, unit: " دقیقه" },
];

const M_DAY = [
  { key: "mood",      label: "خلق",           higherBetter: true },
  { key: "focus",     label: "تمرکز",         higherBetter: true },
  { key: "anxiety",   label: "اضطراب",        higherBetter: false },
  { key: "stress",    label: "استرس",         higherBetter: false },
  { key: "energy",    label: "انرژی",         higherBetter: true },
  { key: "dayRating", label: "امتیاز روز",    higherBetter: true },
];
const M_NIGHT = [
  { key: "sleepLatency", label: "زمان به خواب رفتن شب بعد (دقیقه)", higherBetter: false, lag: 1 },
  { key: "awakenings",   label: "بیداری شبانه‌ی شب بعد",            higherBetter: false, lag: 1 },
  { key: "sleepQuality", label: "کیفیت خواب شب بعد",                higherBetter: true,  lag: 1 },
  { key: "restedness",   label: "احساس استراحت صبح بعد",            higherBetter: true,  lag: 1 },
  { key: "sleepHours",   label: "ساعت خواب شب بعد",                 higherBetter: true,  lag: 1 },
];
const M_SLEEP = [
  { key: "sleepQuality", label: "کیفیت خواب",               higherBetter: true },
  { key: "sleepLatency", label: "زمان به خواب رفتن (دقیقه)", higherBetter: false },
  { key: "sleepHours",   label: "ساعت خواب",                higherBetter: true },
  { key: "restedness",   label: "احساس استراحت",            higherBetter: true },
];
const pickMetrics = (list, keys) => list.filter((m) => keys.includes(m.key));

let doc = null;
let allEntries = [];
let visibleEntries = [];

const $ = (id) => document.getElementById(id);

/* ============================================================
   Date helpers
   ============================================================ */

const pad2 = (n) => String(n).padStart(2, "0");

function todayKey() {
  const d = new Date();
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function keyToNum(key) {
  const [y, m, d] = key.split("-").map(Number);
  return Math.round(Date.UTC(y, m - 1, d) / DAY_MS);
}

function numToKey(n) {
  const t = new Date(n * DAY_MS);
  return `${t.getUTCFullYear()}-${pad2(t.getUTCMonth() + 1)}-${pad2(t.getUTCDate())}`;
}

function fmtHour(h) {
  if (h == null) return "—";
  const total = Math.round(h * 60);
  return `${pad2(Math.floor(total / 60) % 24)}:${pad2(total % 60)}`;
}

function lastFullNum() {
  for (let i = allEntries.length - 1; i >= 0; i--) if (allEntries[i].eve) return allEntries[i].dayNum;
  return allEntries[allEntries.length - 1].dayNum;
}

function getAnchor() {
  const todayNum = keyToNum(todayKey());
  const lastNum = lastFullNum();
  return todayNum - lastNum <= 1 ? lastNum : todayNum;
}

function inWindow(entries, anchor, days) {
  return entries.filter((d) => d.dayNum > anchor - days && d.dayNum <= anchor);
}

/* ============================================================
   Load
   ============================================================ */

function setDoc(d) {
  doc = d;
  allEntries = normalizeEntries(d.entries);
}

function readBackup() {
  try {
    const raw = localStorage.getItem(LOCAL_BACKUP_KEY);
    if (!raw) return null;
    return { doc: parseCheckinDocument(raw), text: raw };
  } catch (err) {
    console.warn("Backup load failed:", err);
    return null;
  }
}

async function readRemembered() {
  try {
    const h = await FileStorage.loadHandle(HANDLE_KEY);
    if (!h) return null;
    if (!(await FileStorage.ensurePermission(h, false))) return null;
    const text = await FileStorage.readText(h);
    if (!text.trim()) return null;
    return { doc: parseCheckinDocument(text), text };
  } catch (err) {
    console.warn("Auto-connect failed:", err);
    return null;
  }
}

const updatedMs = (src) => (src ? Date.parse(src.doc.updatedAt) || 0 : -1);

function maybeUpdateBackup(src, backup) {
  if (updatedMs(src) < updatedMs(backup)) return;
  try { localStorage.setItem(LOCAL_BACKUP_KEY, src.text); } catch {}
}

async function init() {
  bindEvents();
  const backup = readBackup();
  const file = await readRemembered();
  let best = null;
  if (backup && file) best = updatedMs(file) > updatedMs(backup) ? file : backup;
  else best = file || backup;
  if (best) {
    if (best === file) maybeUpdateBackup(file, backup);
    setDoc(best.doc);
  }
  render();
}

function errorDetail(err) {
  if (err instanceof CheckinDataError) return err.details?.[0] || err.message;
  return err?.message || String(err);
}

async function connectFile() {
  try {
    const h = await FileStorage.pickOpenFile();
    await FileStorage.saveHandle(h, HANDLE_KEY);
    const text = await FileStorage.readText(h);
    if (!text.trim()) return;
    const src = { doc: parseCheckinDocument(text), text };
    maybeUpdateBackup(src, readBackup());
    setDoc(src.doc);
    render();
  } catch (err) {
    if (err?.name !== "AbortError") {
      console.error(err);
      alert("خطا در باز کردن فایل: " + errorDetail(err));
    }
  }
}

async function importFile(file) {
  try {
    const text = await file.text();
    setDoc(parseCheckinDocument(text));
    render();
  } catch (err) {
    console.error(err);
    alert("فایل نامعتبر است: " + errorDetail(err));
  }
}

/* ============================================================
   Normalize (v6)
   ============================================================ */

function numOr(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

function hourToNum(t) {
  if (!t || typeof t !== "string") return null;
  const [h, m] = t.split(":").map(Number);
  if (!Number.isFinite(h)) return null;
  return h + (m || 0) / 60;
}

const l5to10 = (v) => (v == null ? null : Math.round((1 + ((v - 1) * 9) / 4) * 10) / 10);

function normalizeEntries(raw) {
  const list = raw.map((e) => {
    const mor = !!e.slots?.morning;
    const eve = !!e.slots?.evening;

    const bedTime = e.sleep?.bedTime ?? null;
    const bedHour = hourToNum(bedTime);

    const routineDone = mor ? !!e.relaxationRoutine?.done : null;

    // medication (v6 effect + sideEffects)
    const med = e.medication || {};
    const am = med.morning || {};
    const pm = med.afternoon || {};
    const medKnown = !!med.recorded;
    const medAm = medKnown ? !!am.taken : null;
    const medPm = medKnown && eve ? !!pm.taken : null;
    const medDay = medKnown && eve ? !!am.taken || !!pm.taken : null;
    const medAmEffect = medAm ? numOr(am.effect) : null;
    const medPmEffect = medPm ? numOr(pm.effect) : null;
    const medAmSideCount = medAm && Array.isArray(am.sideEffects) ? am.sideEffects.length : null;
    const medPmSideCount = medPm && Array.isArray(pm.sideEffects) ? pm.sideEffects.length : null;

    // explicit
    const x = e.explicit || {};
    const xKnown = eve && !!x.recorded;

    // food
    const food = e.food || {};
    const foodLogged = eve && !!food.logged;
    const log = food.log || {};
    const foodIds = foodLogged ? MEALS.flatMap((m) => log[m.id] || []) : [];
    const countTags = (tags) => foodIds.filter((id) => foodTags(id).some((t) => tags.includes(t))).length;

    // exercise
    const exRec = !!e.exercise?.recorded;
    const exerciseDone = exRec ? !!e.exercise?.done : null;

    // masturbation (v6 reframe)
    const mastEve = eve && (e.masturbation?.recorded ?? false);
    const mastDone = mastEve ? !!e.masturbation?.done : null;
    const mastCount = mastEve ? (mastDone ? (numOr(e.masturbation?.count) ?? 1) : 0) : null;
    const mastUrge = mastEve && mastDone ? numOr(e.masturbation?.urgeIntensity) : null;
    const mastGuilt = mastEve && mastDone ? numOr(e.masturbation?.guilt) : null;
    const mastContext = mastEve && mastDone ? (e.masturbation?.context ?? null) : null;
    // backward-compat derived
    const mastNeg = mastDone === null ? null : mastDone && (mastContext === "stress" || (mastUrge != null && mastUrge >= 3));
    const mastPos = mastDone === null ? null : mastDone && !mastNeg;

    // v6 items (raw 1-5 → 1-10)
    const items = e.items || {};

    // v6 side-vehicles
    const physical = e.physical || {};
    const social = e.social || {};
    const events = e.events || {};
    const eventTagsList = Array.isArray(events.tags) ? events.tags : [];
    const circadian = e.circadian || {};
    const scores = e.scores || {};

    // responseMeta
    const rm = e.responseMeta || {};
    const eveMeta = rm.evening || null;
    const morMeta = rm.morning || null;

    const o = {
      date: e.date,
      dayNum: keyToNum(e.date),
      mor,
      eve,
      travel: e.travel === true ? true : e.travel === false ? false : null,

      // sleep
      bedTime,
      wakeTime: e.sleep?.wakeTime ?? null,
      bedNum: bedHour == null ? null : bedHour < 12 ? bedHour + 24 : bedHour,
      wakeNum: hourToNum(e.sleep?.wakeTime),
      sleepHours: numOr(e.sleep?.hours),
      sleepQuality: numOr(e.sleep?.quality),
      sleepLatency: numOr(e.sleep?.latencyMin),
      awakenings: numOr(e.sleep?.awakenings),
      restedness: numOr(e.sleep?.restedness),
      napsMin: numOr(e.sleep?.napsMin),
      sleepCaffeineTime: hourToNum(e.sleep?.lastCaffeineTime),
      screenBeforeBedMin: numOr(e.sleep?.screenBeforeBedMin),

      // routine
      routineDone,
      routineEff: routineDone ? numOr(e.relaxationRoutine?.effectiveness) : null,
      routineSteps: routineDone ? numOr(e.relaxationRoutine?.steps) : null,

      // medication
      medKnown,
      medAm,
      medPm,
      medDay,
      medAmTime: medAm ? hourToNum(am.time) : null,
      medPmTime: medPm ? hourToNum(pm.time) : null,
      medAmEffect,
      medPmEffect,
      medAmSideCount,
      medPmSideCount,
      medText: medKnown ? (medAm ? "ص" : "") + (medAm && medPm ? " + " : "") + (medPm ? "ع" : "") : null,

      // morning
      morningMood: numOr(e.morningState?.mood),
      morningEnergy: numOr(e.morningState?.energy),
      morningTension: numOr(e.morningState?.tension),

      // evening
      mood: numOr(e.mood?.rating),
      stress: numOr(e.mood?.stress),
      energy: numOr(e.mood?.energy),
      focus: numOr(e.mood?.focus),
      anxiety: numOr(e.mood?.anxiety),
      dayRating: numOr(e.dayRating),

      // wellbeing & ADHD (v6 items)
      irritability: l5to10(numOr(items.irritability)),
      anhedonia: l5to10(numOr(items.anhedonia)),
      rumination: l5to10(numOr(items.rumination)),
      meaningfulness: l5to10(numOr(items.meaningfulness)),
      focusQuality: l5to10(numOr(items.focusQuality)),
      taskProcrastination: l5to10(numOr(items.taskProcrastination)),
      emotionalDysregulation: l5to10(numOr(items.emotionalDysregulation)),

      // physical
      headache: numOr(physical.headache),
      bodyPain: numOr(physical.bodyPain),
      fatigueBeyond: numOr(physical.fatigueBeyond),
      digestive: numOr(physical.digestive),

      // social
      socialContact: eve ? (social.meaningfulContact === true ? true : social.meaningfulContact === false ? false : null) : null,
      loneliness: l5to10(numOr(social.loneliness)),

      // events
      stressorCount: numOr(events.stressorCount),
      eventTags: eventTagsList,

      // circadian
      morningLightMin: numOr(circadian.morningOutdoorLight),
      eveningBrightLight: eve ? (circadian.eveningBrightLight === true ? true : circadian.eveningBrightLight === false ? false : null) : null,

      // activities
      activity1: eve ? e.activity1 : null,
      operation1: eve ? e.operation1 : null,

      // exercise
      exerciseDone,
      exerciseMin: exRec ? (exerciseDone ? numOr(e.exercise?.minutes) : 0) : null,
      exerciseType: exerciseDone ? (e.exercise?.type ?? null) : null,
      exerciseIntensity: exerciseDone ? (e.exercise?.intensity ?? null) : null,
      exerciseTime: exerciseDone ? (e.exercise?.timeOfDay ?? null) : null,

      // masturbation
      mastDone,
      mastCount,
      mastUrge,
      mastGuilt,
      mastContext,
      mastNeg,
      mastPos,
      mastPosCount: mastDone === null ? null : (mastPos ? (numOr(e.masturbation?.count) ?? 1) : 0),
      mastNegCount: mastDone === null ? null : (mastNeg ? (numOr(e.masturbation?.count) ?? 1) : 0),

      // explicit
      explicitViewed: xKnown ? !!x.viewed : null,
      explicitMin: xKnown ? (x.viewed ? numOr(x.minutes) : 0) : null,
      explicitUrge: xKnown ? !!x.viewed && x.driver === "urge" : null,
      explicitRegret: xKnown && x.viewed ? numOr(x.regret) : null,
      explicitContext: xKnown && x.viewed ? (x.context ?? null) : null,

      // food
      meals: eve ? numOr(food.meals) : null,
      foodQuality: numOr(food.quality),
      water: eve ? !!food.water : null,
      waterGlasses: eve ? numOr(food.waterGlasses) : null,
      caffeine: eve ? numOr(food.caffeine) : null,
      caffeineCups: eve ? numOr(food.caffeineCups) : null,
      caffeineLastTime: eve ? hourToNum(food.caffeineLastTime) : null,
      sugarEpisodes: eve ? numOr(food.sugarEpisodes) : null,
      firstMealTime: eve ? hourToNum(food.firstMealTime) : null,
      lastMealTime: eve ? hourToNum(food.lastMealTime) : null,
      foodLogged,
      foodIds,
      fruitCount: foodLogged ? countTags(["fruit"]) : null,
      vegCount: foodLogged ? countTags(["veg"]) : null,
      unhealthyCount: foodLogged ? countTags(["fried", "fastfood", "junk", "sweet"]) : null,
      breakfastLogged: foodLogged ? (log.breakfast || []).length > 0 : null,

      // precomputed composite scores (0-100)
      scores: {
        sleepHealth: numOr(scores.sleepHealth),
        moodIndex: numOr(scores.moodIndex),
        anxietyIndex: numOr(scores.anxietyIndex),
        energyIndex: numOr(scores.energyIndex),
        focusIndex: numOr(scores.focusIndex),
        adherenceScore: numOr(scores.adherenceScore),
        nutritionScore: numOr(scores.nutritionScore),
        recoveryScore: numOr(scores.recoveryScore),
        adhdIndex: numOr(scores.adhdIndex),
      },

      // response quality
      eveDurationMs: eveMeta?.durationMs ?? null,
      eveItemsSkipped: eveMeta?.itemsSkipped ?? null,
      eveItemsAnswered: eveMeta?.itemsAnswered ?? null,
      morDurationMs: morMeta?.durationMs ?? null,

      notes: e.notes,
    };
    o.score = computeMentalScore(o);
    return o;
  }).sort((a, b) => a.dayNum - b.dayNum);

  for (const d of list) {
    const vals = list
      .filter((x) => x.dayNum > d.dayNum - 7 && x.dayNum <= d.dayNum && x.score != null)
      .map((x) => x.score);
    d.scoreMA = vals.length >= 3 ? Math.round(mean(vals) * 10) / 10 : null;
  }
  return list;
}

/* ============================================================
   Stats helpers
   ============================================================ */

const mean = (a) => a.reduce((x, y) => x + y, 0) / a.length;

function sd(a) {
  if (a.length < 2) return null;
  const m = mean(a);
  return Math.sqrt(a.reduce((s, v) => s + (v - m) ** 2, 0) / (a.length - 1));
}

function average(arr, field) {
  const vals = arr.map((e) => e[field]).filter((v) => typeof v === "number");
  if (!vals.length) return null;
  return Math.round(mean(vals) * 10) / 10;
}

function rank(arr) {
  const idx = arr.map((v, i) => [v, i]).sort((a, b) => a[0] - b[0]);
  const r = new Array(arr.length);
  for (let i = 0; i < idx.length; ) {
    let j = i;
    while (j + 1 < idx.length && idx[j + 1][0] === idx[i][0]) j++;
    const avg = (i + j) / 2 + 1;
    for (let k = i; k <= j; k++) r[idx[k][1]] = avg;
    i = j + 1;
  }
  return r;
}

function pearsonRaw(xs, ys) {
  const mx = mean(xs), my = mean(ys);
  let num = 0, dx = 0, dy = 0;
  for (let i = 0; i < xs.length; i++) {
    num += (xs[i] - mx) * (ys[i] - my);
    dx += (xs[i] - mx) ** 2;
    dy += (ys[i] - my) ** 2;
  }
  const den = Math.sqrt(dx * dy);
  return den ? num / den : null;
}

function spearman(pairs) {
  const n = pairs.length;
  if (n < MIN_CORR_N) return { r: null, n };
  const r = pearsonRaw(rank(pairs.map((p) => p[0])), rank(pairs.map((p) => p[1])));
  return { r: r == null ? null : Math.round(r * 100) / 100, n };
}

function welch(a, b) {
  const sa = sd(a), sb = sd(b);
  if (sa == null || sb == null) return null;
  const se = Math.sqrt((sa * sa) / a.length + (sb * sb) / b.length);
  return se ? (mean(a) - mean(b)) / se : null;
}

function compareGroups(entries, inA, inB, metrics) {
  const byNum = new Map(entries.map((d) => [d.dayNum, d]));
  const A = entries.filter((d) => inA(d) === true);
  const B = entries.filter((d) => inB(d) === true);
  const rows = [];
  for (const m of metrics) {
    const pick = (grp) =>
      grp.map((d) => (m.lag ? byNum.get(d.dayNum + m.lag) : d)?.[m.key]).filter((v) => typeof v === "number");
    const a = pick(A);
    const b = pick(B);
    if (a.length < MIN_GROUP_N || b.length < MIN_GROUP_N) continue;
    const diff = mean(a) - mean(b);
    const t = welch(a, b);
    rows.push({
      label: m.label,
      ma: mean(a), mb: mean(b), na: a.length, nb: b.length, diff,
      sig: t != null && Math.abs(t) >= SIG_T && a.length >= SIG_MIN_N && b.length >= SIG_MIN_N,
      better: diff > 0 === m.higherBetter,
    });
  }
  return { rows, na: A.length, nb: B.length };
}

/* ============================================================
   Analytics core
   ============================================================ */

function computeMentalScore(d) {
  if (!d.eve) return null;
  const parts = [];
  let evParts = 0;
  if (d.sleepHours != null) {
    let s;
    if (d.sleepHours >= 7 && d.sleepHours <= 9) s = 10;
    else if (d.sleepHours < 7) s = Math.max(1, 10 - (7 - d.sleepHours) * 2);
    else s = Math.max(1, 10 - (d.sleepHours - 9) * 1.5);
    parts.push({ w: 0.12, v: s });
  }
  if (d.sleepQuality != null) parts.push({ w: 0.1, v: d.sleepQuality });
  if (d.restedness != null) parts.push({ w: 0.05, v: d.restedness });
  if (d.mood != null) { parts.push({ w: 0.22, v: d.mood }); evParts++; }
  if (d.stress != null) { parts.push({ w: 0.2, v: 11 - d.stress }); evParts++; }
  if (d.energy != null) { parts.push({ w: 0.12, v: d.energy }); evParts++; }
  if (d.anxiety != null) { parts.push({ w: 0.12, v: 11 - d.anxiety }); evParts++; }
  if (d.focus != null) { parts.push({ w: 0.07, v: d.focus }); evParts++; }
  if (parts.length < 3 || evParts < 2) return null;
  const tw = parts.reduce((a, p) => a + p.w, 0);
  const s = parts.reduce((a, p) => a + p.w * p.v, 0) / tw;
  return Math.round(s * 10) / 10;
}

function stateLabel(score) {
  if (score == null) return { text: "—", tone: "muted" };
  if (score >= 8.5) return { text: "پایدار و پرانرژی", tone: "good" };
  if (score >= 7)   return { text: "خوب", tone: "good" };
  if (score >= 5.5) return { text: "متوسط", tone: "mid" };
  if (score >= 4)   return { text: "ضعیف — نیاز به توجه", tone: "warn" };
  return { text: "هشدار — نیاز به استراحت", tone: "bad" };
}

function stateHint(score) {
  if (score == null) return "داده‌ی کافی برای تحلیل نیست.";
  if (score >= 8.5) return "خواب، خلق و استرس در محدوده‌ی سالم است. روند فعلی را حفظ کن.";
  if (score >= 7)   return "وضعیت خوب است، ولی جا برای بهبود وجود دارد (کیفیت خواب یا کاهش استرس).";
  if (score >= 5.5) return "روزها متوسط‌اند. به خواب و روتین آرام‌سازی بیشتر توجه کن.";
  if (score >= 4)   return "چند سیگنال ضعیف با هم جمع شده‌اند. یک روز سبک‌تر و خواب بیشتر می‌تواند کمک کند.";
  return "سیستم روانی زیر فشار است. یک روز استراحت واقعی، خواب کافی، و قطع فشارهای غیرضروری توصیه می‌شود.";
}

function computeDeviations(entries, anchor) {
  const recent = inWindow(entries, anchor, RECENT_DAYS);
  const base = entries.filter(
    (d) => d.dayNum <= anchor - RECENT_DAYS && d.dayNum > anchor - RECENT_DAYS - BASELINE_DAYS && !d.travel
  );
  const out = [];
  for (const m of BASELINE_METRICS) {
    const r = recent.map((d) => d[m.key]).filter((v) => typeof v === "number");
    const b = base.map((d) => d[m.key]).filter((v) => typeof v === "number");
    if (r.length < BASELINE_MIN_RECENT || b.length < BASELINE_MIN_BASE) continue;
    const mr = mean(r), mb = mean(b);
    const sb = Math.max(sd(b) ?? 0, m.floor ?? SD_FLOOR);
    const d = (mr - mb) / sb;
    out.push({ ...m, mr, mb, sb, d, worse: m.bad === "high" ? d : -d });
  }
  return out;
}

function detectWarnings(entries) {
  const out = [];
  if (!entries.length) return out;
  const push = (text, level) => out.push({ text, level });

  const anchor = getAnchor();
  const todayNum = keyToNum(todayKey());
  const byNum = new Map(entries.map((d) => [d.dayNum, d]));
  const w7 = inWindow(entries, anchor, 7);
  const w7e = w7.filter((d) => d.eve);
  const w7m = w7.filter((d) => d.mor);
  const w14e = inWindow(entries, anchor, 14).filter((d) => d.eve);
  const travel7 = w7.filter((d) => d.travel).length;
  const inTravel = travel7 >= TRAVEL_NOTE_DAYS;

  const streak = (n, pred) => {
    for (let i = 0; i < n; i++) {
      const d = byNum.get(anchor - i);
      if (!d || !pred(d)) return false;
    }
    return true;
  };

  const gap = todayNum - lastFullNum();
  if (gap >= 3) push(`${gap} روز است چک‌این کامل (شب) ثبت نشده؛ تحلیل‌ها بر اساس داده‌ی قدیمی‌اند.`, "warn");
  else if (w14e.length < 9) push(`فقط ${w14e.length} روز از ۱۴ روز اخیر کامل ثبت شده؛ دقت تحلیل پایین است.`, "warn");

  if (streak(3, (d) => d.stress != null && d.stress >= 7)) push("۳ روز پیوسته استرس بالا (۷+) — نشانه‌ی فشار انباشته.", "danger");
  if (streak(3, (d) => d.sleepHours != null && d.sleepHours < 6)) push("۳ روز پیوسته کمتر از ۶ ساعت خواب.", "danger");
  if (streak(3, (d) => d.mood != null && d.mood <= 4)) push("۳ روز پیوسته خلق پایین (۴ یا کمتر).", "danger");
  if (streak(3, (d) => d.anxiety != null && d.anxiety >= 7)) push("۳ روز پیوسته اضطراب بالا (۷+).", "danger");

  // v6: physical alarm — 3 days headache/fatigue
  if (streak(3, (d) => d.headache != null && d.headache >= 2)) push("۳ روز پیوسته سردرد متوسط تا شدید.", "danger");
  if (streak(3, (d) => d.fatigueBeyond != null && d.fatigueBeyond >= 2)) push("۳ روز پیوسته خستگی غیرمعمول متوسط تا شدید.", "warn");

  if (w14e.length >= 10) {
    const low = w14e.filter((d) => d.mood != null && d.mood <= 4).length;
    if (low >= 7) {
      push(`خلق پایین در ${low} روز از ۱۴ روز اخیر. اگر این وضعیت ادامه دارد، صحبت با مشاور یا روان‌شناس منطقی است (این ابزار تشخیص نیست).`, "danger");
    }
  }

  if (w7e.length >= MIN_COVERAGE_7) {
    const urge = w7e.filter((d) => d.mastNeg || d.explicitUrge).length;
    if (urge >= 3) push(`رفتارهای فشار-محور (خودارضایی منفی یا محتوای تحریک‌آمیز از روی اجبار) در ${urge} روز از ${w7e.length} روز کامل هفته‌ی اخیر — نشانه‌ی فشار روانی.`, "danger");

    const foodDays = w7e.filter((d) => d.foodQuality != null);
    const foodAvg = average(foodDays, "foodQuality");
    if (foodAvg != null && foodDays.length >= 4 && foodAvg < 5) push(`میانگین کیفیت تغذیه در هفته‌ی اخیر ${foodAvg}/۱۰ — پایین.`, "warn");

    const waterDays = w7e.filter((d) => d.water || (d.waterGlasses != null && d.waterGlasses >= 6)).length;
    if (waterDays <= 2) push("آب کافی در بیشتر روزهای هفته‌ی اخیر مصرف نشده.", "warn");
  }

  const exKnown = w7.filter((d) => d.exerciseDone !== null);
  if (exKnown.length >= 4) {
    const exDays = exKnown.filter((d) => d.exerciseDone).length;
    if (exDays <= 1) push(`ورزش فقط ${exDays} بار در ${exKnown.length} روز ثبت‌شده‌ی هفته‌ی اخیر.`, "warn");
  }

  if (w7m.length >= MIN_COVERAGE_7) {
    const routineDays = w7m.filter((d) => d.routineDone).length;
    if (routineDays <= 2) push("روتین آرام‌سازی در بیشتر روزهای اخیر انجام نشده.", "warn");
  }

  const beds = w7.map((d) => d.bedNum).filter((v) => v != null);
  if (beds.length >= 4 && !inTravel) {
    const spread = Math.round(sd(beds) * 60);
    if (spread > 90) push(`ساعت خواب بین شب‌ها نامنظم است (نوسان حدود ${spread} دقیقه).`, "warn");
  }

  for (const x of computeDeviations(entries, anchor)) {
    if (x.worse < DEV_WARN) continue;
    const u = x.unit || "";
    push(
      `${x.label} نسبت به الگوی معمول خودت بدتر شده: میانگین ۷ روز اخیر ${x.mr.toFixed(1)}${u} در برابر معمول ${x.mb.toFixed(1)}${u}.` +
        (inTravel ? " (بخشی از هفته در سفر بوده‌ای؛ تغییر ریتم در سفر طبیعی است.)" : ""),
      x.worse >= DEV_DANGER && !inTravel ? "danger" : "warn"
    );
  }

  return out.sort((a, b) => (a.level === "danger" ? 0 : 1) - (b.level === "danger" ? 0 : 1));
}

/* ---------- Correlations (v6) ---------- */

const CORR_DEFS = [
  // Sleep → same day
  { label: "ساعت خواب × خلق همان روز",               x: "sleepHours",     y: "mood",         lag: 0 },
  { label: "ساعت خواب × استرس همان روز",             x: "sleepHours",     y: "stress",       lag: 0 },
  { label: "کیفیت خواب × خلق همان روز",               x: "sleepQuality",   y: "mood",         lag: 0 },
  { label: "ساعت خواب × تمرکز همان روز",             x: "sleepHours",     y: "focus",        lag: 0 },
  { label: "احساس استراحت صبح × تمرکز همان روز",     x: "restedness",     y: "focus",        lag: 0 },
  { label: "اثر روتین × کیفیت خوابِ همان شب",        x: "routineEff",     y: "sleepQuality", lag: 0 },
  { label: "اثر روتین × خلق",                         x: "routineEff",     y: "mood",         lag: 0 },

  // Day → next night (v6 sleep extras)
  { label: "استرس امروز × کیفیت خواب شب بعد",         x: "stress",         y: "sleepQuality", lag: 1 },
  { label: "اضطراب امروز × زمان به خواب رفتن شب بعد", x: "anxiety",        y: "sleepLatency", lag: 1 },
  { label: "کافئین امروز × زمان به خواب رفتن شب بعد", x: "caffeine",       y: "sleepLatency", lag: 1 },
  { label: "لیوان کافئین × اضطراب همان روز",          x: "caffeineCups",   y: "anxiety",      lag: 0 },
  { label: "ساعت آخرین کافئین × زمان به خواب شب بعد", x: "caffeineLastTime", y: "sleepLatency", lag: 1 },
  { label: "چرت روزانه × کیفیت خواب شب بعد",          x: "napsMin",        y: "sleepQuality", lag: 0 },
  { label: "صفحه‌نمایش قبل خواب × زمان به خواب",       x: "screenBeforeBedMin", y: "sleepLatency", lag: 0 },
  { label: "نور صبح × کیفیت خواب شب بعد",              x: "morningLightMin", y: "sleepQuality", lag: 1 },

  // Exercise (v6: type/intensity/time)
  { label: "دقایق ورزش امروز × خلق فردا",             x: "exerciseMin",    y: "mood",         lag: 1 },
  { label: "دقایق ورزش امروز × کیفیت خواب شب بعد",    x: "exerciseMin",    y: "sleepQuality", lag: 1 },
  { label: "دقایق ورزش امروز × زمان به خواب شب بعد",  x: "exerciseMin",    y: "sleepLatency", lag: 1 },

  // Medication (v6: effect + timing)
  { label: "ساعت قرص عصر × زمان به خواب شب بعد",      x: "medPmTime",      y: "sleepLatency", lag: 1 },
  { label: "اثر قرص صبح × تمرکز همان روز",            x: "medAmEffect",    y: "focus",        lag: 0 },
  { label: "اثر قرص عصر × خلق همان روز",              x: "medPmEffect",    y: "mood",         lag: 0 },
  { label: "تعداد عوارض صبح × استرس همان روز",         x: "medAmSideCount", y: "stress",       lag: 0 },

  // Behavior (v6: reframed)
  { label: "شدت میل خودارضایی × استرس همان روز",      x: "mastUrge",       y: "stress",       lag: 0 },
  { label: "احساس گناه خودارضایی × خلق همان روز",      x: "mastGuilt",      y: "mood",         lag: 0 },
  { label: "احساس گناه خودارضایی × خلق فردا",          x: "mastGuilt",      y: "mood",         lag: 1 },
  { label: "خودارضایی منفی × استرس همان روز",         x: "mastNegCount",   y: "stress",       lag: 0 },
  { label: "خودارضایی منفی × خلق همان روز",           x: "mastNegCount",   y: "mood",         lag: 0 },
  { label: "دقایق محتوای تحریک‌آمیز × استرس همان روز", x: "explicitMin",    y: "stress",       lag: 0 },
  { label: "دقایق محتوای تحریک‌آمیز × کیفیت خواب شب بعد", x: "explicitMin", y: "sleepQuality", lag: 1 },
  { label: "پشیمانی محتوا × خلق فردا",                 x: "explicitRegret", y: "mood",         lag: 1 },

  // Nutrition (v6: extra fields)
  { label: "کیفیت تغذیه × خلق همان روز",              x: "foodQuality",    y: "mood",         lag: 0 },
  { label: "تعداد میوه × خلق همان روز",               x: "fruitCount",     y: "mood",         lag: 0 },
  { label: "تعداد سبزی/سالاد × انرژی همان روز",       x: "vegCount",       y: "energy",       lag: 0 },
  { label: "خوراکی ناسالم × انرژی همان روز",          x: "unhealthyCount", y: "energy",       lag: 0 },
  { label: "لیوان آب × سرعت به خواب شب بعد",           x: "waterGlasses",   y: "sleepLatency", lag: 0 },
  { label: "دفعات قند/شیرینی × خلق فردا",             x: "sugarEpisodes",  y: "mood",         lag: 1 },
  { label: "ساعت اولین وعده × انرژی همان روز",         x: "firstMealTime",  y: "energy",       lag: 0 },

  // Physical (v6)
  { label: "شدت سردرد × استرس همان روز",              x: "headache",       y: "stress",       lag: 0 },
  { label: "درد بدن × کیفیت خواب شب بعد",             x: "bodyPain",       y: "sleepQuality", lag: 1 },
  { label: "خستگی غیرمعمول × خلق همان روز",            x: "fatigueBeyond",  y: "mood",         lag: 0 },

  // Social / events / wellbeing (v6)
  { label: "احساس تنهایی × خلق همان روز",              x: "loneliness",     y: "mood",         lag: 0 },
  { label: "تعداد رویداد استرس‌زا × اضطراب همان روز",  x: "stressorCount",  y: "anxiety",      lag: 0 },
  { label: "تعداد رویداد استرس‌زا × کیفیت خواب شب بعد", x: "stressorCount", y: "sleepQuality", lag: 1 },
  { label: "نشخوار فکری × زمان به خواب شب بعد",        x: "rumination",     y: "sleepLatency", lag: 0 },
  { label: "بی‌لذتی (anhedonia) × خلق فردا",           x: "anhedonia",      y: "mood",         lag: 1 },
  { label: "معناداری × خلق همان روز",                  x: "meaningfulness", y: "mood",         lag: 0 },

  // v6 composite scores (already normalized 0-100)
  { label: "امتیاز خواب (composite) × خلق فردا",      x: "scores.sleepHealth", y: "mood",     lag: 1 },
  { label: "امتیاز بازیابی × انرژی همان روز",           x: "scores.recoveryScore", y: "energy", lag: 0 },

  // Day → next day
  { label: "امتیاز روز × خلق فردا",                    x: "dayRating",      y: "mood",         lag: 1 },
];

function computeCorrelations(entries) {
  const byNum = new Map(entries.map((d) => [d.dayNum, d]));
  const out = [];
  for (const def of CORR_DEFS) {
    const pairs = [];
    for (const d of entries) {
      const o = def.lag === 0 ? d : byNum.get(d.dayNum + def.lag);
      const x = d[def.x];
      const y = o?.[def.y];
      if (typeof x === "number" && typeof y === "number") pairs.push([x, y]);
    }
    const { r, n } = spearman(pairs);
    if (r == null) continue;
    out.push({ label: def.label, v: r, n, sig: Math.abs(r) >= CORR_SIG_K / Math.sqrt(n) });
  }
  return out;
}

/* ============================================================
   Render
   ============================================================ */

function render() {
  if (!doc || !allEntries.length) {
    $("caEmpty").hidden = false;
    $("caContent").hidden = true;
    $("caCount").textContent = "—";
    return;
  }

  const anchor = getAnchor();
  const range = Number($("caRangeSelect").value) || 0;
  visibleEntries = range > 0 ? allEntries.filter((d) => d.dayNum > anchor - range) : allEntries;

  $("caEmpty").hidden = true;
  $("caContent").hidden = false;
  const cov14 = inWindow(allEntries, anchor, 14).filter((d) => d.eve).length;
  $("caCount").textContent =
    `${allEntries.length} روز ثبت‌شده — نمایش ${visibleEntries.length} روز — چک‌این کامل ۱۴ روز اخیر: ${cov14}/۱۴`;

  renderSummary();
  renderState();
  renderWarnings();
  renderSleepChart();
  renderMoodChart();
  renderSwing();
  renderAdhdMedication();
  renderPhysical();
  renderWellbeing();
  renderCircadianSleepEnv();
  renderBehavioral();
  renderFood();
  renderExerciseBreakdown();
  renderTravel();
  renderResponseQuality();
  renderInterventions();
  renderCorrelations();
  renderHeatmap();
  renderTable();
}

/* ---------- Shared panel helpers ---------- */

function setPanel(id, title, html) {
  let p = $(id);
  if (!p) {
    p = document.createElement("section");
    p.className = "ca-panel";
    p.id = id;
    p.innerHTML = `<h2 class="ca-panel__title">${title}</h2><div class="ca-panel__body"></div>`;
    const anchor = $("caCorr")?.closest(".ca-panel");
    if (anchor) anchor.before(p);
    else $("caContent").appendChild(p);
  }
  p.querySelector(".ca-panel__body").innerHTML = html;
  return p;
}

const behaviorCard = (label, value, unit = "", extra = "") => `
  <div class="ca-behavior">
    <div class="ca-behavior__label">${label}</div>
    <div class="ca-behavior__value">${value}${unit ? `<small> ${unit}</small>` : ""}</div>
    ${extra}
  </div>`;

const cardsGrid = (cards) => `<div class="ca-behaviors">${cards.join("")}</div>`;
const subTitle = (t) =>
  `<div class="ca-card__label" style="margin:16px 0 8px;font-weight:600;color:var(--ca-text)">${t}</div>`;
const tag = (text, color = "var(--ca-accent)") =>
  `<span style="display:inline-block;padding:2px 9px;margin:2px;border-radius:999px;font-size:11px;background:${color};color:#fff">${text}</span>`;

function renderCompare(title, comp, la, lb) {
  let html = subTitle(title);
  if (!comp.rows.length) {
    return html + `<p class="ca-hint">داده‌ی کافی نیست: ${la} ${comp.na} روز، ${lb} ${comp.nb} روز (حداقل ${MIN_GROUP_N} روز با داده‌ی همان معیار در هر گروه لازم است).</p>`;
  }
  html += `<div class="ca-corr">`;
  html += comp.rows.map((r) => {
    const col = r.better ? "var(--ca-good)" : "var(--ca-bad)";
    return `
    <div class="ca-corr-row" style="${r.sig ? "" : "opacity:0.55"}">
      <div class="ca-corr-row__label">${r.label}</div>
      <div style="display:flex;gap:12px;align-items:center;font-size:12px;font-variant-numeric:tabular-nums;white-space:nowrap">
        <span>${la} ${r.ma.toFixed(1)} <small style="color:var(--ca-muted)">(n=${r.na})</small></span>
        <span>${lb} ${r.mb.toFixed(1)} <small style="color:var(--ca-muted)">(n=${r.nb})</small></span>
        <b style="color:${col};min-width:44px;text-align:center">${r.diff > 0 ? "+" : ""}${r.diff.toFixed(1)}</b>
      </div>
    </div>`;
  }).join("");
  return html + `</div>`;
}

const COMPARE_HINT = `<p class="ca-hint">Δ = گروه اول منهای گروه دوم؛ سبز یعنی به نفع وضعیت بهتر. ردیف‌های کم‌رنگ هنوز قابل‌اتکا نیستند. مقایسه‌ها روی کل تاریخچه است. این‌ها رابطه‌اند، نه علت.</p>`;

/* ---------- Summary cards ---------- */

function renderSummary() {
  const e = visibleEntries;
  const avgSleep = average(e, "sleepHours");
  const avgMood = average(e, "mood");
  const avgStress = average(e, "stress");
  const avgAnxiety = average(e, "anxiety");
  const avgFocus = average(e, "focus");
  const avgEnergy = average(e, "energy");
  const avgQuality = average(e, "sleepQuality");
  const avgLatency = average(e, "sleepLatency");
  const beds = e.map((d) => d.bedNum).filter((v) => v != null);
  const bedSpread = beds.length >= 4 ? Math.round(sd(beds) * 60) : null;
  const hiBad = (v) => (v == null ? null : v >= 6 ? "bad" : v <= 4 ? "good" : null);

  const cards = [
    { label: "میانگین خواب", value: avgSleep, unit: "ساعت", sub: `کیفیت ${avgQuality ?? "—"}/۱۰` },
    { label: "میانگین خلق", value: avgMood, unit: "/۱۰" },
    { label: "میانگین استرس", value: avgStress, unit: "/۱۰", tone: hiBad(avgStress) },
    { label: "میانگین اضطراب", value: avgAnxiety, unit: "/۱۰", tone: hiBad(avgAnxiety) },
    { label: "میانگین تمرکز", value: avgFocus, unit: "/۱۰" },
    { label: "میانگین انرژی", value: avgEnergy, unit: "/۱۰" },
    { label: "زمان به خواب رفتن", value: avgLatency, unit: "دقیقه" },
    {
      label: "نوسان ساعت خواب", value: bedSpread, unit: "دقیقه",
      tone: bedSpread == null ? null : bedSpread > 75 ? "bad" : bedSpread < 45 ? "good" : null,
    },
  ];

  $("caSummary").innerHTML = cards.map((c) => `
    <div class="ca-card">
      <div class="ca-card__label">${c.label}</div>
      <div class="ca-card__value" style="${c.tone === "bad" ? "color:var(--ca-bad)" : c.tone === "good" ? "color:var(--ca-good)" : ""}">
        ${c.value ?? "—"}${c.value != null ? `<small>${c.unit}</small>` : ""}
      </div>
      ${c.sub ? `<div class="ca-card__sub">${c.sub}</div>` : ""}
    </div>
  `).join("");
}

/* ---------- State gauge ---------- */

function renderState() {
  const anchor = getAnchor();
  const recent = inWindow(allEntries, anchor, 7).filter((d) => d.score != null);
  const prev = allEntries.filter((d) => d.score != null && d.dayNum <= anchor - 7 && d.dayNum > anchor - 14);

  if (recent.length < 3) {
    $("caGauge").innerHTML = "";
    $("caStateLabel").textContent = "—";
    $("caStateLabel").style.color = "var(--ca-text)";
    $("caStateTrend").textContent = "داده‌ی کافی نیست (حداقل ۳ روز چک‌این کامل در ۷ روز اخیر لازم است).";
    $("caStateHint").textContent = "";
    return;
  }

  const cur = mean(recent.map((d) => d.score));
  const prevAvg = prev.length >= 3 ? mean(prev.map((d) => d.score)) : null;
  const label = stateLabel(cur);
  $("caStateLabel").textContent = label.text;
  $("caStateLabel").style.color =
    label.tone === "good" ? "var(--ca-good)"
    : label.tone === "bad" || label.tone === "warn" ? "var(--ca-bad)"
    : label.tone === "mid" ? "var(--ca-warn)"
    : "var(--ca-text)";

  let trendText = "داده‌ی مقایسه‌ای کافی نیست.";
  if (prevAvg != null) {
    const diff = Math.round((cur - prevAvg) * 10) / 10;
    const arrow = diff > 0.3 ? "▲" : diff < -0.3 ? "▼" : "◀▶";
    const word = diff > 0.3 ? "بهبود" : diff < -0.3 ? "افت" : "پایدار";
    trendText = `${arrow} ${word} نسبت به هفته‌ی قبل (${diff > 0 ? "+" : ""}${diff})`;
  }
  const dev = computeDeviations(allEntries, anchor).find((x) => x.key === "score");
  if (dev) {
    const delta = Math.round((dev.mr - dev.mb) * 10) / 10;
    trendText += ` — نسبت به سطح معمول خودت (${dev.mb.toFixed(1)}): ${delta > 0 ? "+" : ""}${delta}`;
  }
  $("caStateTrend").textContent = trendText;

  let hint = stateHint(cur);
  if (recent.length < MIN_COVERAGE_7) hint += ` (اعتبار پایین: فقط ${recent.length} از ۷ روز کامل ثبت شده)`;
  if (inWindow(allEntries, anchor, 7).filter((d) => d.travel).length >= TRAVEL_NOTE_DAYS) {
    hint += " (هفته‌ی اخیر در سفر بوده‌ای؛ مقایسه‌ها را با احتیاط بخوان)";
  }
  $("caStateHint").textContent = hint;

  const pct = Math.max(0, Math.min(1, (cur - 1) / 9));
  const angle = -90 + pct * 180;
  const color = cur >= 7 ? "var(--ca-good)" : cur >= 5.5 ? "var(--ca-warn)" : "var(--ca-bad)";
  const cx = 110, cy = 100, r = 80;

  $("caGauge").innerHTML = `
    <svg viewBox="0 0 220 130">
      <defs>
        <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stop-color="hsl(0,70%,50%)" />
          <stop offset="50%"  stop-color="hsl(45,80%,55%)" />
          <stop offset="100%" stop-color="hsl(120,55%,48%)" />
        </linearGradient>
      </defs>
      <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}"
            fill="none" stroke="url(#gaugeGrad)" stroke-width="14"
            stroke-linecap="round" opacity="0.35" />
      <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}"
            fill="none" stroke="url(#gaugeGrad)" stroke-width="14"
            stroke-linecap="round"
            stroke-dasharray="${(pct * Math.PI * r).toFixed(1)} ${(Math.PI * r).toFixed(1)}" />
      <g transform="translate(${cx} ${cy}) rotate(${angle})">
        <line x1="0" y1="0" x2="0" y2="${-(r - 12)}" stroke="${color}" stroke-width="3" stroke-linecap="round" />
        <circle r="5" fill="${color}" />
      </g>
      <text x="${cx}" y="${cy - 12}" text-anchor="middle" font-size="26" font-weight="700" fill="${color}">
        ${cur.toFixed(1)}
      </text>
      <text x="${cx - r}" y="${cy + 22}" text-anchor="middle" font-size="10" fill="var(--ca-muted)">۱</text>
      <text x="${cx + r}" y="${cy + 22}" text-anchor="middle" font-size="10" fill="var(--ca-muted)">۱۰</text>
    </svg>`;
}

/* ---------- Warnings ---------- */

function renderWarnings() {
  const w = detectWarnings(allEntries);
  if (!w.length) { $("caWarningsPanel").hidden = true; return; }
  $("caWarningsPanel").hidden = false;
  $("caWarnings").innerHTML = w
    .map((x) => `<div class="ca-warn-item ${x.level === "danger" ? "ca-warn-item--danger" : ""}">${x.text}</div>`)
    .join("");
}

/* ---------- Charts ---------- */

function renderSleepChart() {
  const series = [
    { key: "sleepHours",   color: "#6ea8ff", label: "خواب (ساعت)" },
    { key: "sleepQuality", color: "#a78bfa", label: "کیفیت خواب (۱–۱۰)" },
    { key: "restedness",   color: "#22d3ee", label: "احساس استراحت (۱–۱۰)" },
  ];
  const el = $("caSleepChart");
  el.innerHTML = buildLineChart(el, visibleEntries, series, {
    yMin: 0, yMax: 12,
    bands: [{ from: 7, to: 9, color: "var(--ca-good)" }],
  });
  renderLegend(el, [...series, { color: "var(--ca-good)", label: "بازه‌ی سالم خواب (۷–۹ ساعت)" }]);
}

function renderMoodChart() {
  const series = [
    { key: "mood",    color: "#34d399", label: "خلق" },
    { key: "stress",  color: "#f87171", label: "استرس" },
    { key: "anxiety", color: "#fb923c", label: "اضطراب" },
    { key: "energy",  color: "#fbbf24", label: "انرژی" },
    { key: "scoreMA", color: "#a78bfa", label: "میانگین ۷روزه‌ی امتیاز روانی", dash: "6 4", noDots: true },
  ];
  const el = $("caMoodChart");
  el.innerHTML = buildLineChart(el, visibleEntries, series, { yMin: 1, yMax: 10 });
  renderLegend(el, series);
}

function renderLegend(chartEl, series) {
  let lg = chartEl.nextElementSibling;
  if (!lg || !lg.classList.contains("ca-legend")) {
    lg = document.createElement("div");
    lg.className = "ca-legend";
    chartEl.after(lg);
  }
  lg.innerHTML = series
    .map((s) => `<span><span class="dot" style="background:${s.color}"></span>${s.label}</span>`)
    .join("");
}

function buildLineChart(el, data, series, { yMin = 0, yMax = 10, bands = [] } = {}) {
  if (!data.length) return "";
  const W = Math.max(320, el.clientWidth || 800);
  const H = 220;
  const padL = 34, padR = 12, padT = 14, padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const minNum = data[0].dayNum;
  const maxNum = data[data.length - 1].dayNum;
  const span = maxNum - minNum;
  const xAt = (num) => (span === 0 ? padL + innerW / 2 : padL + ((num - minNum) / span) * innerW);
  const clamp = (v) => Math.max(yMin, Math.min(yMax, v));
  const yAt = (v) => padT + innerH - ((clamp(v) - yMin) / (yMax - yMin)) * innerH;

  let bandSvg = "";
  for (const b of bands) {
    const y1 = yAt(b.to), y2 = yAt(b.from);
    bandSvg += `<rect x="${padL}" y="${y1}" width="${innerW}" height="${y2 - y1}" fill="${b.color}" opacity="0.1" />`;
  }

  let grid = "";
  const yTicks = 5;
  for (let i = 0; i <= yTicks; i++) {
    const v = yMin + ((yMax - yMin) * i) / yTicks;
    const y = yAt(v);
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--ca-border)" stroke-width="1" opacity="0.5" />`;
    grid += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="var(--ca-muted)">${Math.round(v)}</text>`;
  }

  let xLabels = "";
  const tickCount = Math.min(6, span + 1);
  for (let i = 0; i < tickCount; i++) {
    const num = minNum + Math.round((span * i) / (tickCount - 1 || 1));
    xLabels += `<text x="${xAt(num)}" y="${H - 8}" text-anchor="middle" font-size="9" fill="var(--ca-muted)">${numToKey(num).slice(5)}</text>`;
  }

  let lines = "";
  let dots = "";
  for (const s of series) {
    const segs = [];
    let seg = [];
    let prevNum = null;
    for (const d of data) {
      const v = d[s.key];
      if (typeof v !== "number") continue;
      if (prevNum != null && d.dayNum - prevNum > 1) { segs.push(seg); seg = []; }
      seg.push([xAt(d.dayNum), yAt(v)]);
      prevNum = d.dayNum;
    }
    if (seg.length) segs.push(seg);

    for (const sg of segs) {
      if (sg.length > 1) {
        const poly = sg.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
        lines += `<polyline points="${poly}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round"${s.dash ? ` stroke-dasharray="${s.dash}"` : ""} />`;
      }
      if (!s.noDots) for (const [x, y] of sg) dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.4" fill="${s.color}" />`;
    }
  }

  return `<svg viewBox="0 0 ${W} ${H}">${bandSvg}${grid}${xLabels}${lines}${dots}</svg>`;
}

/* ---------- Swing (morning vs evening) ---------- */

function renderSwing() {
  const e = visibleEntries;
  const has = e.some((d) => d.morningMood != null || d.morningEnergy != null);
  if (!has) {
    setPanel("caSwingPanel", "حال صبح در برابر شب", `<p class="ca-hint">هنوز داده‌ی «حال صبح» نیست — از چک‌این صبح شروع می‌شود.</p>`);
    return;
  }

  const f = (k) => average(e, k) ?? "—";
  const html = cardsGrid([
    behaviorCard("حال صبح", f("morningMood"), "/۱۰"),
    behaviorCard("خلق شب", f("mood"), "/۱۰"),
    behaviorCard("انرژی صبح", f("morningEnergy"), "/۱۰"),
    behaviorCard("انرژی شب", f("energy"), "/۱۰"),
    behaviorCard("تنش صبح", f("morningTension"), "/۱۰"),
  ]) + `<div class="ca-chart" id="caSwingChart" style="margin-top:14px"></div>`
   + `<p class="ca-hint">حال صبح با یک جمله و خلق/انرژی شب با چند جمله سنجیده می‌شود؛ پس عددها دقیقاً هم‌مقیاس نیستند. روند و فاصله‌ی دو خط را ببین.</p>`;
  setPanel("caSwingPanel", "حال صبح در برابر شب", html);

  const series = [
    { key: "morningMood",   color: "#34d399", dash: "5 4", label: "حال صبح" },
    { key: "mood",          color: "#34d399", label: "خلق شب" },
    { key: "morningEnergy", color: "#fbbf24", dash: "5 4", label: "انرژی صبح" },
    { key: "energy",        color: "#fbbf24", label: "انرژی شب" },
  ];
  const el = $("caSwingChart");
  el.innerHTML = buildLineChart(el, e, series, { yMin: 1, yMax: 10 });
  renderLegend(el, series);
}

/* ---------- ADHD & Medication ---------- */

function renderAdhdMedication() {
  const e = visibleEntries;
  const rec = e.filter((d) => d.medKnown);
  const adhdDays = e.filter((d) => d.focusQuality != null || d.taskProcrastination != null || d.emotionalDysregulation != null);

  if (!rec.length && !adhdDays.length) {
    setPanel("caAdhdPanel", "ADHD و قرص", `<p class="ca-hint">هنوز داده‌ای نیست — از چک‌این شب بعدی شروع می‌شود.</p>`);
    return;
  }

  // Behavior — medication
  let medBlock = "";
  if (rec.length) {
    const am = rec.filter((d) => d.medAm).length;
    const pmKnown = e.filter((d) => d.medPm !== null);
    const pm = pmKnown.filter((d) => d.medPm).length;
    const amT = rec.map((d) => d.medAmTime).filter((v) => v != null);
    const pmT = e.map((d) => d.medPmTime).filter((v) => v != null);
    const amEff = rec.map((d) => d.medAmEffect).filter((v) => typeof v === "number");
    const pmEff = e.map((d) => d.medPmEffect).filter((v) => typeof v === "number");
    const amSides = rec.map((d) => d.medAmSideCount).filter((v) => typeof v === "number");
    const pmSides = e.map((d) => d.medPmSideCount).filter((v) => typeof v === "number");

    medBlock = subTitle("قرص ADHD") + cardsGrid([
      behaviorCard("روز ثبت‌شده", rec.length, "روز"),
      behaviorCard("قرص صبح", am, `/ ${rec.length} روز`),
      behaviorCard("قرص عصر", pm, `/ ${pmKnown.length} روز`),
      behaviorCard("میانگین ساعت صبح", amT.length ? fmtHour(mean(amT)) : "—"),
      behaviorCard("میانگین ساعت عصر", pmT.length ? fmtHour(mean(pmT)) : "—"),
      behaviorCard("میانگین اثر صبح", amEff.length ? (Math.round(mean(amEff) * 10) / 10) : "—", "/۱۰"),
      behaviorCard("میانگین اثر عصر", pmEff.length ? (Math.round(mean(pmEff) * 10) / 10) : "—", "/۱۰"),
      behaviorCard("میانگین عوارض صبح", amSides.length ? (Math.round(mean(amSides) * 10) / 10) : "—", "مورد"),
      behaviorCard("میانگین عوارض عصر", pmSides.length ? (Math.round(mean(pmSides) * 10) / 10) : "—", "مورد"),
    ]);
  }

  // Behavior — ADHD outcomes
  let adhdBlock = "";
  if (adhdDays.length) {
    const f = (k) => average(adhdDays, k) ?? "—";
    adhdBlock = subTitle("شاخص‌های ADHD (۱ = اصلاً · ۱۰ = خیلی زیاد)") + cardsGrid([
      behaviorCard("کیفیت تمرکز", f("focusQuality"), "/۱۰"),
      behaviorCard("به تعویق انداختن کارها", f("taskProcrastination"), "/۱۰"),
      behaviorCard("بی‌نظمی هیجانی", f("emotionalDysregulation"), "/۱۰"),
      behaviorCard("میانگین امتیاز ADHD", average(e, "scores.adhdIndex") ?? "—", "/۱۰۰"),
    ]);
  }

  // Compare: with vs without med
  const day = compareGroups(allEntries, (d) => d.medDay === true, (d) => d.medDay === false, M_DAY);
  const night = compareGroups(allEntries, (d) => d.medPm === true, (d) => d.medPm === false, M_NIGHT);

  setPanel(
    "caAdhdPanel",
    "ADHD و قرص",
    medBlock + adhdBlock +
      renderCompare("همان روز: با قرص در برابر بدون قرص", day, "با قرص", "بدون قرص") +
      renderCompare("خواب شب بعد: بعد از قرص عصر در برابر بدون قرص عصر", night, "با قرص عصر", "بدون") +
      COMPARE_HINT +
      `<p class="ca-hint">ممکن است روزهای سخت‌تر را با قرص بگذرانی، پس تفاوت‌ها الزاماً اثر قرص نیستند. اگر بین قرص عصر و خواب شب بعد الگویی دیدی، با پزشکت در میان بگذار؛ دوز و زمان را خودت تغییر نده.</p>`
  );
}

/* ---------- Physical ---------- */

function renderPhysical() {
  const e = visibleEntries;
  const days = e.filter((d) => d.headache != null || d.bodyPain != null || d.fatigueBeyond != null || d.digestive != null);
  if (!days.length) {
    setPanel("caPhysPanel", "علائم جسمی", `<p class="ca-hint">هنوز داده‌ای نیست — از چک‌این شب بعدی شروع می‌شود.</p>`);
    return;
  }

  const sevLabel = (v) => (v == null ? "—" : v < 0.5 ? "هیچ" : v < 1.5 ? "کم" : v < 2.5 ? "متوسط" : "شدید");
  const avg = (k) => average(days, k);
  const anyDay = (k) => days.filter((d) => typeof d[k] === "number" && d[k] >= 1).length;

  const cards = cardsGrid([
    behaviorCard("روز ثبت‌شده", days.length, "روز"),
    behaviorCard("سردرد — روزهای دارای علامت", anyDay("headache"), `/ ${days.length} روز`),
    behaviorCard("سردرد — شدت میانگین", sevLabel(avg("headache"))),
    behaviorCard("درد بدن — روزهای دارای علامت", anyDay("bodyPain"), `/ ${days.length} روز`),
    behaviorCard("درد بدن — شدت میانگین", sevLabel(avg("bodyPain"))),
    behaviorCard("خستگی غیرمعمول — روزهای دارای علامت", anyDay("fatigueBeyond"), `/ ${days.length} روز`),
    behaviorCard("خستگی — شدت میانگین", sevLabel(avg("fatigueBeyond"))),
    behaviorCard("گوارشی — روزهای دارای علامت", anyDay("digestive"), `/ ${days.length} روز`),
    behaviorCard("گوارشی — شدت میانگین", sevLabel(avg("digestive"))),
  ]);

  const cmp = compareGroups(
    allEntries,
    (d) => (d.headache != null && d.headache >= 2) || (d.fatigueBeyond != null && d.fatigueBeyond >= 2),
    (d) => d.headache === 0 && d.fatigueBeyond === 0,
    [...M_DAY, ...pickMetrics(M_NIGHT, ["sleepQuality", "sleepLatency"])]
  );

  setPanel(
    "caPhysPanel",
    "علائم جسمی",
    cards +
      renderCompare("روز دارای سردرد/خستگی متوسط+ در برابر روز بدون", cmp, "دارای علامت", "بدون") +
      COMPARE_HINT
  );
}

/* ---------- Wellbeing / Social / Events ---------- */

function renderWellbeing() {
  const e = visibleEntries;
  const wells = e.filter((d) =>
    d.irritability != null || d.anhedonia != null || d.rumination != null || d.meaningfulness != null
  );
  const socials = e.filter((d) => d.socialContact !== null || d.loneliness != null);
  const events = e.filter((d) => d.stressorCount != null || d.eventTags?.length);

  if (!wells.length && !socials.length && !events.length) {
    setPanel("caWellPanel", "احساسات، ارتباط و رویدادها", `<p class="ca-hint">هنوز داده‌ای نیست.</p>`);
    return;
  }

  let html = "";

  if (wells.length) {
    const f = (k) => average(wells, k) ?? "—";
    html += subTitle("احساسات و معنا (۱ = اصلاً · ۱۰ = خیلی زیاد)") + cardsGrid([
      behaviorCard("تحریک‌پذیری / زود عصبانی شدن", f("irritability"), "/۱۰"),
      behaviorCard("بی‌لذتی", f("anhedonia"), "/۱۰"),
      behaviorCard("نشخوار فکری", f("rumination"), "/۱۰"),
      behaviorCard("معناداری", f("meaningfulness"), "/۱۰"),
    ]);
  }

  if (socials.length) {
    const contactDays = socials.filter((d) => d.socialContact === true).length;
    const socialKnown = socials.filter((d) => d.socialContact !== null).length;
    html += subTitle("ارتباط اجتماعی") + cardsGrid([
      behaviorCard("روزهای با ارتباط معنادار", contactDays, `/ ${socialKnown} روز`),
      behaviorCard("احساس تنهایی", average(socials, "loneliness") ?? "—", "/۱۰"),
    ]);

    const socialCmp = compareGroups(
      allEntries,
      (d) => d.socialContact === true,
      (d) => d.socialContact === false,
      pickMetrics(M_DAY, ["mood", "anxiety", "stress"])
    );
    html += renderCompare("روز با ارتباط معنادار در برابر بدون", socialCmp, "با ارتباط", "بدون");
  }

  if (events.length) {
    const evTags = {};
    for (const d of events) for (const t of d.eventTags || []) evTags[t] = (evTags[t] || 0) + 1;
    const tagList = Object.entries(evTags).sort((a, b) => b[1] - a[1]);
    const tagHtml = tagList.length
      ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${tagList.map(([t, c]) => tag(`${t} × ${c}`)).join("")}</div>`
      : "";

    html += subTitle("رویدادهای استرس‌زا") + cardsGrid([
      behaviorCard("روزهای با ≥ ۱ رویداد", events.filter((d) => (d.stressorCount ?? 0) >= 1).length, `/ ${events.length} روز`),
      behaviorCard("میانگین تعداد رویداد در روز", average(events, "stressorCount") ?? "—", "رویداد"),
    ]) + (tagHtml ? `<div style="margin-top:10px">${tagHtml}</div>` : "");

    const eventsCmp = compareGroups(
      allEntries,
      (d) => (d.stressorCount ?? 0) >= 1,
      (d) => d.stressorCount === 0,
      [...pickMetrics(M_DAY, ["anxiety", "stress", "mood"]), ...pickMetrics(M_NIGHT, ["sleepQuality", "sleepLatency"])]
    );
    html += renderCompare("روز دارای رویداد استرس‌زا در برابر بدون", eventsCmp, "با رویداد", "بدون");
  }

  setPanel("caWellPanel", "احساسات، ارتباط و رویدادها", html + COMPARE_HINT);
}

/* ---------- Circadian & Sleep Environment ---------- */

function renderCircadianSleepEnv() {
  const e = visibleEntries;
  const circ = e.filter((d) => d.morningLightMin != null || d.eveningBrightLight !== null);
  const sleepEnv = e.filter((d) => d.napsMin != null || d.sleepCaffeineTime != null || d.screenBeforeBedMin != null);

  if (!circ.length && !sleepEnv.length) {
    setPanel("caCircPanel", "محیط خواب و ریتم شبانه‌روزی", `<p class="ca-hint">هنوز داده‌ای نیست.</p>`);
    return;
  }

  let html = "";
  if (circ.length) {
    const lightMin = circ.map((d) => d.morningLightMin).filter((v) => typeof v === "number");
    const eveningDays = circ.filter((d) => d.eveningBrightLight === true).length;
    const eveningKnown = circ.filter((d) => d.eveningBrightLight !== null).length;
    html += cardsGrid([
      behaviorCard("میانگین نور صبح", lightMin.length ? Math.round(mean(lightMin)) : "—", "دقیقه"),
      behaviorCard("روزهای با نور شدید شب", eveningDays, `/ ${eveningKnown} روز`),
    ]);

    const circCmp = compareGroups(
      allEntries,
      (d) => (d.morningLightMin ?? 0) >= 30,
      (d) => d.morningLightMin != null && d.morningLightMin < 30,
      pickMetrics(M_NIGHT, ["sleepQuality", "sleepLatency"])
    );
    html += renderCompare("نور صبح ≥ ۳۰ دقیقه در برابر کمتر", circCmp, "≥ ۳۰ دقیقه", "< ۳۰");
  }

  if (sleepEnv.length) {
    const naps = sleepEnv.map((d) => d.napsMin).filter((v) => typeof v === "number");
    const screen = sleepEnv.map((d) => d.screenBeforeBedMin).filter((v) => typeof v === "number");
    const cafTimes = sleepEnv.map((d) => d.sleepCaffeineTime).filter((v) => typeof v === "number");
    html += subTitle("محیط خواب") + cardsGrid([
      behaviorCard("چرت روزانه — روزهای با چرت", naps.filter((v) => v > 0).length, `/ ${naps.length} روز`),
      behaviorCard("میانگین چرت", naps.length ? Math.round(mean(naps)) : "—", "دقیقه"),
      behaviorCard("صفحه‌نمایش قبل خواب — میانگین", screen.length ? Math.round(mean(screen)) : "—", "دقیقه"),
      behaviorCard("آخرین کافئین قبل خواب — میانگین ساعت", cafTimes.length ? fmtHour(mean(cafTimes)) : "—"),
    ]);

    const screenCmp = compareGroups(
      allEntries,
      (d) => (d.screenBeforeBedMin ?? 0) >= 30,
      (d) => d.screenBeforeBedMin != null && d.screenBeforeBedMin < 30,
      pickMetrics(M_NIGHT, ["sleepQuality", "sleepLatency"])
    );
    html += renderCompare("صفحه‌نمایش ≥ ۳۰ دقیقه قبل خواب در برابر کمتر", screenCmp, "≥ ۳۰ دقیقه", "< ۳۰");
  }

  setPanel("caCircPanel", "محیط خواب و ریتم شبانه‌روزی", html + COMPARE_HINT);
}

/* ---------- Behavioral (explicit + masturbation) ---------- */

function renderBehavioral() {
  const e = visibleEntries;
  const mastKnown = e.filter((d) => d.mastDone !== null);
  const xKnown = e.filter((d) => d.explicitViewed !== null);

  if (!mastKnown.length && !xKnown.length) {
    setPanel("caBehavPanel", "رفتارها (خودارضایی و محتوای تحریک‌آمیز)", `<p class="ca-hint">هنوز داده‌ای ثبت نشده.</p>`);
    return;
  }

  let html = "";

  if (mastKnown.length) {
    const done = mastKnown.filter((d) => d.mastDone).length;
    const urges = mastKnown.map((d) => d.mastUrge).filter((v) => typeof v === "number");
    const guilts = mastKnown.map((d) => d.mastGuilt).filter((v) => typeof v === "number");
    const contexts = {};
    for (const d of mastKnown) if (d.mastContext) contexts[d.mastContext] = (contexts[d.mastContext] || 0) + 1;
    const ctxList = Object.entries(contexts).sort((a, b) => b[1] - a[1]);

    html += subTitle("خودارضایی") + cardsGrid([
      behaviorCard("روزهای انجام", done, `/ ${mastKnown.length} روز`),
      behaviorCard("میانگین شدت میل", urges.length ? (Math.round(mean(urges) * 10) / 10) : "—", "/۵"),
      behaviorCard("میانگین احساس گناه", guilts.length ? (Math.round(mean(guilts) * 10) / 10) : "—", "/۵"),
      behaviorCard("مجموع تعداد", mastKnown.reduce((a, d) => a + (d.mastCount || 0), 0), "بار"),
    ]);

    if (ctxList.length) {
      html += `<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">${ctxList.map(([c, n]) => tag(`${c} × ${n}`)).join("")}</div>`;
    }

    const guiltHigh = compareGroups(
      allEntries,
      (d) => d.mastGuilt != null && d.mastGuilt >= 3,
      (d) => d.mastGuilt != null && d.mastGuilt < 3,
      pickMetrics(M_DAY, ["mood", "anxiety", "stress"])
    );
    html += renderCompare("روز با گناه بالا (≥ ۳) در برابر کمتر", guiltHigh, "گناه بالا", "گناه کم");
  }

  if (xKnown.length) {
    const viewed = xKnown.filter((d) => d.explicitViewed);
    const mins = viewed.map((d) => d.explicitMin).filter((v) => typeof v === "number");
    const regret = viewed.map((d) => d.explicitRegret).filter((v) => typeof v === "number");
    const contexts = {};
    for (const d of viewed) if (d.explicitContext) contexts[d.explicitContext] = (contexts[d.explicitContext] || 0) + 1;

    html += subTitle("محتوای تحریک‌آمیز") + cardsGrid([
      behaviorCard("روزهای دیده‌شده", viewed.length, `/ ${xKnown.length} روز`),
      behaviorCard("مجموع دقیقه", mins.reduce((a, b) => a + b, 0), "دقیقه"),
      behaviorCard("میانگین دقیقه", mins.length ? Math.round(mean(mins)) : "—", "دقیقه"),
      behaviorCard("میانگین پشیمانی", regret.length ? (Math.round(mean(regret) * 10) / 10) : "—", "/۵"),
    ]);

    if (Object.keys(contexts).length) {
      html += `<div style="margin-top:10px;display:flex;flex-wrap:wrap;gap:6px">${Object.entries(contexts).map(([c, n]) => tag(`${c} × ${n}`)).join("")}</div>`;
    }

    const viewedCmp = compareGroups(
      allEntries,
      (d) => d.explicitViewed === true,
      (d) => d.explicitViewed === false,
      [...pickMetrics(M_DAY, ["stress", "anxiety", "mood", "focus"]), ...pickMetrics(M_NIGHT, ["sleepQuality", "sleepLatency"])]
    );
    html += renderCompare("روز دیدن در برابر ندیدن", viewedCmp, "دیدم", "ندیدم");
  }

  setPanel("caBehavPanel", "رفتارها (خودارضایی و محتوای تحریک‌آمیز)", html + COMPARE_HINT);
}

/* ---------- Food ---------- */

function renderFood() {
  const e = visibleEntries.filter((d) => d.foodLogged);
  if (!e.length) {
    setPanel("caFoodPanel", "تغذیه", `<p class="ca-hint">هنوز غذایی ثبت نشده.</p>`);
    return;
  }
  const n = e.length;
  const bfPct = Math.round((e.filter((d) => d.breakfastLogged).length / n) * 100);

  const cards = cardsGrid([
    behaviorCard("روز ثبت‌شده", n, "روز"),
    behaviorCard("وعده‌ی اصلی (میانگین)", average(e, "meals") ?? "—", "در روز"),
    behaviorCard("میوه", average(e, "fruitCount") ?? "—", "بار در روز"),
    behaviorCard("سبزی / سالاد", average(e, "vegCount") ?? "—", "بار در روز"),
    behaviorCard("سرخ‌کرده / شیرینی / فست‌فود", average(e, "unhealthyCount") ?? "—", "بار در روز"),
    behaviorCard("آب — لیوان", average(e, "waterGlasses") ?? "—", "لیوان در روز"),
    behaviorCard("قهوه / چای / انرژی‌زا", average(e, "caffeineCups") ?? "—", "لیوان در روز"),
    behaviorCard("دفعات قند / شیرینی", average(e, "sugarEpisodes") ?? "—", "بار در روز"),
    behaviorCard("صبحانه ثبت شده", bfPct, "٪ روزها",
      `<div class="ca-behavior__bar"><span style="width:${bfPct}%; background:var(--ca-accent)"></span></div>`),
    behaviorCard("اولین وعده (میانگین ساعت)",
      (() => { const v = e.map((d) => d.firstMealTime).filter((x) => typeof x === "number"); return v.length ? fmtHour(mean(v)) : "—"; })()),
    behaviorCard("آخرین وعده (میانگین ساعت)",
      (() => { const v = e.map((d) => d.lastMealTime).filter((x) => typeof x === "number"); return v.length ? fmtHour(mean(v)) : "—"; })()),
  ]);

  const counts = new Map();
  for (const d of e) for (const id of d.foodIds) counts.set(id, (counts.get(id) || 0) + 1);
  const top = [...counts].filter(([id]) => foodLabel(id)).sort((a, b) => b[1] - a[1]).slice(0, 12);
  const chips = top.length
    ? `<div style="display:flex;flex-wrap:wrap;gap:6px">${top
        .map(([id, c]) => `<span style="padding:3px 10px;border-radius:999px;background:var(--ca-panel-2);font-size:12px">${foodLabel(id)} <b>${c}</b></span>`)
        .join("")}</div>`
    : "";

  const dayCore = pickMetrics(M_DAY, ["mood", "energy", "anxiety", "focus"]);
  const fruitCmp = compareGroups(allEntries, (d) => d.fruitCount != null && d.fruitCount >= 1, (d) => d.fruitCount === 0, dayCore);
  const unhealthyCmp = compareGroups(allEntries, (d) => d.unhealthyCount != null && d.unhealthyCount >= 1, (d) => d.unhealthyCount === 0,
    [...dayCore, ...pickMetrics(M_NIGHT, ["sleepQuality", "sleepLatency"])]);
  const breakfastCmp = compareGroups(allEntries, (d) => d.breakfastLogged === true, (d) => d.breakfastLogged === false,
    pickMetrics(M_DAY, ["focus", "energy", "mood"]));
  const sugarCmp = compareGroups(allEntries, (d) => (d.sugarEpisodes ?? 0) >= 2, (d) => d.sugarEpisodes === 0,
    [...dayCore, ...pickMetrics(M_NIGHT, ["sleepQuality", "sleepLatency"])]);

  setPanel(
    "caFoodPanel",
    "تغذیه",
    cards +
      (chips ? subTitle("پرتکرارترین‌ها") + chips : "") +
      renderCompare("روز با میوه در برابر بدون میوه", fruitCmp, "با میوه", "بدون") +
      renderCompare("روز با سرخ‌کرده/شیرینی/فست‌فود در برابر بدون آن", unhealthyCmp, "با", "بدون") +
      renderCompare("صبحانه‌ی ثبت‌شده در برابر ثبت‌نشده", breakfastCmp, "با صبحانه", "بدون") +
      renderCompare("≥ ۲ بار قند/شیرینی در برابر بدون", sugarCmp, "≥ ۲ بار", "بدون") +
      COMPARE_HINT
  );
}

/* ---------- Exercise breakdown ---------- */

function renderExerciseBreakdown() {
  const known = visibleEntries.filter((d) => d.exerciseDone === true);
  if (!known.length) return;

  const types = {};
  for (const d of known) if (d.exerciseType) types[d.exerciseType] = (types[d.exerciseType] || 0) + 1;
  const intensities = {};
  for (const d of known) if (d.exerciseIntensity) intensities[d.exerciseIntensity] = (intensities[d.exerciseIntensity] || 0) + 1;
  const times = {};
  for (const d of known) if (d.exerciseTime) times[d.exerciseTime] = (times[d.exerciseTime] || 0) + 1;

  const typeList = Object.entries(types).sort((a, b) => b[1] - a[1]);
  const intensityList = Object.entries(intensities).sort((a, b) => b[1] - a[1]);
  const timeList = Object.entries(times).sort((a, b) => b[1] - a[1]);

  const html =
    subTitle("نوع ورزش") +
    `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">${typeList.map(([t, n]) => tag(`${t} × ${n}`)).join("")}</div>` +
    subTitle("شدت") +
    `<div style="display:flex;flex-wrap:wrap;gap:6px;margin-bottom:12px">${intensityList.map(([t, n]) => tag(`${t} × ${n}`)).join("")}</div>` +
    subTitle("موقع روز") +
    `<div style="display:flex;flex-wrap:wrap;gap:6px">${timeList.map(([t, n]) => tag(`${t} × ${n}`)).join("")}</div>`;

  setPanel("caExercisePanel", "ورزش — تفکیک", html);
}

/* ---------- Travel ---------- */

function renderTravel() {
  const known = allEntries.filter((d) => d.travel !== null);
  const days = allEntries.filter((d) => d.travel === true);
  if (!days.length) {
    setPanel("caTravelPanel", "سفر", `<p class="ca-hint">هنوز روز سفری ثبت نشده.</p>`);
    return;
  }
  let trips = 0, prev = null;
  for (const d of days) { if (prev == null || d.dayNum - prev > 1) trips++; prev = d.dayNum; }

  const cards = cardsGrid([
    behaviorCard("روز سفر", days.length, `/ ${known.length} روز`),
    behaviorCard("تعداد سفر", trips, "سفر"),
  ]);
  const cmp = compareGroups(allEntries, (d) => d.travel === true, (d) => d.travel === false, [...M_DAY, ...M_SLEEP]);

  setPanel("caTravelPanel", "سفر",
    cards + renderCompare("روز سفر در برابر روز عادی", cmp, "سفر", "عادی") + COMPARE_HINT +
    `<p class="ca-hint">روزهای سفر از خط پایه‌ی هشدارها کنار گذاشته می‌شوند. اگر ≥ ۳ روز از هفته سفر بوده، هشدارها نرم‌تر می‌شوند.</p>`);
}

/* ---------- Response Quality ---------- */

function renderResponseQuality() {
  const e = visibleEntries.filter((d) => d.eveDurationMs != null || d.eveItemsSkipped != null);
  if (!e.length) return;

  const durations = e.map((d) => d.eveDurationMs).filter((v) => typeof v === "number");
  const skipped = e.map((d) => d.eveItemsSkipped).filter((v) => typeof v === "number");
  const answered = e.map((d) => d.eveItemsAnswered).filter((v) => typeof v === "number");
  const shortCount = durations.filter((d) => d < 60000).length;
  const longCount = durations.filter((d) => d > 300000).length;

  const cards = cardsGrid([
    behaviorCard("روز ثبت‌شده", e.length, "روز"),
    behaviorCard("میانگین زمان پاسخ (ثانیه)", durations.length ? Math.round(mean(durations) / 1000) : "—"),
    behaviorCard("کمتر از ۶۰ ثانیه", shortCount, "روز", shortCount > 0
      ? `<div class="ca-hint" style="font-size:10px;margin-top:4px">پاسخ سریع؛ اعتبار پایین‌تر</div>` : ""),
    behaviorCard("بیش از ۵ دقیقه", longCount, "روز"),
    behaviorCard("میانگین سؤالات پاسخ‌داده‌شده", answered.length ? Math.round(mean(answered)) : "—"),
    behaviorCard("میانگین سؤالات بی‌پاسخ", skipped.length ? Math.round(mean(skipped)) : "—"),
  ]);

  setPanel(
    "caResponsePanel",
    "کیفیت پاسخ‌دهی",
    cards +
      `<p class="ca-hint">پاسخ‌های کمتر از ۶۰ ثانیه با احتیاط تفسیر شوند — ممکن است شتاب‌زده پر شده باشند. اگر سؤالات بی‌پاسخ زیاد است، احتمالاً پرسشنامه خیلی طولانی بوده.</p>`
  );
}

/* ---------- Interventions & Phases ---------- */

function renderInterventions() {
  const interventions = doc?.interventions || [];
  const phases = doc?.phases || [];
  if (!interventions.length && !phases.length) return;

  const fmtDate = (key) => formatDate(key);
  const stateOf = (i) => (i.endedAt ? `تا ${fmtDate(i.endedAt)}` : "جاری");
  const items = interventions.map((i) => `
    <div style="padding:8px 10px;margin:6px 0;border-right:3px solid ${i.color || "var(--ca-accent)"};background:var(--ca-panel-2);border-radius:6px">
      <b>${i.name}</b> <small style="color:var(--ca-muted)">${i.type}</small>
      <div class="ca-hint" style="margin-top:2px">${fmtDate(i.startedAt)} — ${stateOf(i)}${i.dosage ? ` · ${i.dosage}` : ""}</div>
      ${i.notes ? `<div class="ca-hint" style="margin-top:2px">${i.notes}</div>` : ""}
    </div>`).join("");

  const phaseItems = phases.map((p) => `
    <div style="padding:6px 10px;margin:4px 0;border-right:3px solid var(--ca-accent);background:var(--ca-panel-2);border-radius:6px;font-size:12px">
      <b>${p.type}</b> — ${fmtDate(p.startDate)}${p.endDate ? ` تا ${fmtDate(p.endDate)}` : " (جاری)"}
      ${p.label ? ` · ${p.label}` : ""}
    </div>`).join("");

  setPanel(
    "caIntervPanel",
    "مداخلات و فازها (N-of-1)",
    (items ? `<div class="ca-card__label" style="font-weight:600;margin-bottom:6px">مداخلات</div>${items}` : "") +
    (phaseItems ? `<div class="ca-card__label" style="font-weight:600;margin:10px 0 6px">فازها</div>${phaseItems}` : "") +
    `<p class="ca-hint">مداخلات و فازها را می‌توانی برای شروع/پایان مداخلات ثبت کنی (supplement، habit، medication، behavioral، diet). تحلیل ITS در نسخه‌های بعدی می‌آید.</p>`
  );
}

/* ---------- Correlations ---------- */

function renderCorrelations() {
  const corr = computeCorrelations(allEntries);
  if (!corr.length) {
    $("caCorr").innerHTML = `<p class="ca-hint">داده‌ی کافی برای محاسبه‌ی همبستگی وجود ندارد (حداقل ${MIN_CORR_N} روز داده‌ی جفت‌شده لازم است).</p>`;
    return;
  }
  corr.sort((a, b) => (b.sig - a.sig) || (Math.abs(b.v) - Math.abs(a.v)));
  const shown = corr.slice(0, CORR_SHOW);

  $("caCorr").innerHTML = shown.map((r) => {
    const v = r.v;
    const pct = Math.abs(v) * 50;
    const fillStyle = v >= 0
      ? `left:50%; width:${pct}%; background:var(--ca-good)`
      : `right:50%; width:${pct}%; background:var(--ca-bad)`;
    return `
      <div class="ca-corr-row" style="${r.sig ? "" : "opacity:0.5"}">
        <div class="ca-corr-row__label">${r.label} <small style="color:var(--ca-muted)">(n=${r.n})</small></div>
        <div style="display:flex; align-items:center; gap:10px;">
          <div class="ca-corr-row__bar"><div class="ca-corr-row__fill" style="${fillStyle}"></div></div>
          <div class="ca-corr-row__val">${v > 0 ? "+" : ""}${v.toFixed(2)}</div>
        </div>
      </div>`;
  }).join("") +
    `<p class="ca-hint">ضریب اسپیرمن؛ ${shown.length} مورد برتر از ${corr.length} جفتِ دارای داده‌ی کافی. همبستگی به معنی علت نیست. ردیف‌های کم‌رنگ هنوز از نوسان تصادفی قابل‌تشخیص نیستند.</p>`;
}

/* ---------- Heatmap ---------- */

function renderHeatmap() {
  if (!visibleEntries.length) { $("caHeatmap").innerHTML = ""; return; }
  const scoreByNum = new Map();
  const travelDays = new Set();
  for (const d of visibleEntries) {
    if (d.score != null) scoreByNum.set(d.dayNum, d.score);
    if (d.travel) travelDays.add(d.dayNum);
  }
  const first = visibleEntries[0].dayNum;
  const last = visibleEntries[visibleEntries.length - 1].dayNum;
  let html = "";
  for (let n = first; n <= last; n++) {
    const key = numToKey(n);
    const s = scoreByNum.get(n);
    const trav = travelDays.has(n);
    const color = s == null ? "var(--ca-panel-2)" : scoreToColor(s);
    const tip = (s == null ? `${key} — بدون داده` : `${key} — ${s.toFixed(1)}/۱۰`) + (trav ? " ✈ سفر" : "");
    const ring = trav ? ";box-shadow:inset 0 0 0 2px var(--ca-accent)" : "";
    html += `<div class="ca-heat-cell" style="background:${color}${ring}" data-tip="${tip}"></div>`;
  }
  $("caHeatmap").innerHTML = html;
}

function scoreToColor(s) {
  const t = Math.max(0, Math.min(1, (s - 1) / 9));
  return `hsl(${t * 120}, 65%, 45%)`;
}

/* ---------- Table (v6 columns) ---------- */

const TABLE_COLS = [
  { key: "date",             label: "تاریخ" },
  { key: "travel",           label: "سفر" },
  { key: "score",            label: "امتیاز" },
  { key: "sleepHours",       label: "خواب (س)" },
  { key: "sleepQuality",     label: "کیفیت" },
  { key: "sleepLatency",     label: "تا خواب" },
  { key: "routineDone",      label: "روتین" },
  { key: "medText",          label: "قرص" },
  { key: "mood",             label: "خلق" },
  { key: "stress",           label: "استرس" },
  { key: "anxiety",          label: "اضطراب" },
  { key: "focus",            label: "تمرکز" },
  { key: "energy",           label: "انرژی" },
  { key: "focusQuality",     label: "تمرکز (ADHD)" },
  { key: "irritability",     label: "تحریک‌پذیری" },
  { key: "exerciseMin",      label: "ورزش (دق)" },
  { key: "exerciseType",     label: "نوع" },
  { key: "mastDone",         label: "خودارضایی" },
  { key: "explicitMin",      label: "محتوا (دق)" },
  { key: "headache",         label: "سردرد" },
  { key: "fatigueBeyond",    label: "خستگی" },
  { key: "stressorCount",    label: "رویداد" },
  { key: "foodQuality",      label: "کیفیت غذا" },
  { key: "waterGlasses",     label: "آب (لیوان)" },
  { key: "dayRating",        label: "امتیاز روز" },
];

const ZERO_AS_DASH = new Set(["exerciseMin", "mastDone", "explicitMin"]);

function cellFor(c, d) {
  const dash = { v: "—", cls: "muted" };
  const raw = d[c.key];
  if (c.key === "date") return { v: formatDate(raw), cls: "date" };
  if (c.key === "travel") return raw ? { v: "✈", cls: "" } : dash;
  if (c.key === "routineDone") return raw ? { v: "✓", cls: "ca-cell-good" } : dash;
  if (c.key === "mastDone") return raw === true ? { v: "✓", cls: "ca-cell-bad" } : raw === false ? { v: "—", cls: "muted" } : dash;
  if (c.key === "exerciseType") return raw ? { v: raw, cls: "" } : dash;
  if (raw === null || raw === undefined || raw === "") return dash;
  if (c.key === "medText") return { v: raw, cls: "ca-cell-good" };
  if (c.key === "score") return { v: raw.toFixed(1), cls: raw >= 7 ? "ca-cell-good" : raw <= 4 ? "ca-cell-bad" : "" };
  if (c.key === "headache" || c.key === "fatigueBeyond") {
    const labels = ["—", "کم", "متوسط", "شدید"];
    return { v: labels[raw] ?? raw, cls: raw >= 2 ? "ca-cell-bad" : "" };
  }
  if (ZERO_AS_DASH.has(c.key) && raw === 0) return dash;

  let cls = "";
  if ((c.key === "stress" || c.key === "anxiety" || c.key === "irritability") && raw >= 6) cls = "ca-cell-bad";
  if (c.key === "mood" || c.key === "energy" || c.key === "focus" || c.key === "focusQuality") {
    if (raw >= 7) cls = "ca-cell-good";
    if (raw <= 3) cls = "ca-cell-bad";
  }
  return { v: raw, cls };
}

function renderTable() {
  const rows = [...visibleEntries].reverse();
  let html = "<thead><tr>";
  for (const c of TABLE_COLS) html += `<th>${c.label}</th>`;
  html += "</tr></thead><tbody>";
  for (const d of rows) {
    html += "<tr>";
    for (const c of TABLE_COLS) {
      const { v, cls } = cellFor(c, d);
      html += `<td class="${cls}">${v}</td>`;
    }
    html += "</tr>";
  }
  html += "</tbody>";
  $("caTable").innerHTML = html;
}

function formatDate(key) {
  const d = new Date(key + "T00:00:00");
  const fa = new Intl.DateTimeFormat("fa-IR", { month: "short", day: "2-digit" });
  const en = key.slice(5);
  return `${fa.format(d)} (${en})`;
}

/* ============================================================
   Events
   ============================================================ */

function bindEvents() {
  $("caConnectBtn").addEventListener("click", connectFile);
  $("caImportInput").addEventListener("change", async (ev) => {
    const f = ev.target.files?.[0];
    if (f) await importFile(f);
    ev.target.value = "";
  });
  $("caRangeSelect").addEventListener("change", render);

  let resizeTimer = null;
  window.addEventListener("resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (doc && allEntries.length) {
        renderSleepChart();
        renderMoodChart();
        renderSwing();
      }
    }, 150);
  });

  const savedTheme = localStorage.getItem("study-timer:theme") || "dark";
  document.body.dataset.theme = savedTheme;
}

init();