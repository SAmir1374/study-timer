/* =============================================================
   ui/modals/checkinModal.js — Daily check-in modal
   ============================================================= */

import { el } from "../elements.js";

let currentDateKey = null;

/* ---------- helpers ---------- */

function numOrNull(v) {
  if (v === "" || v == null) return null;
  const n = Number(v);
  return Number.isFinite(n) ? n : null;
}

function intOrNull(v) {
  const n = numOrNull(v);
  return n == null ? null : Math.round(n);
}

function strOrNull(v) {
  const s = (v ?? "").trim();
  return s === "" ? null : s;
}

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

export function recalcSleepHours() {
  const hours = computeSleepHours(el.checkinBedTime?.value || "", el.checkinWakeTime?.value || "");
  if (hours == null) return;
  if (el.checkinSleepHours) el.checkinSleepHours.value = String(hours);
}

/* ---------- fill helpers ---------- */

function setCheckbox(id, v) {
  const e = el[id];
  if (e) e.checked = !!v;
}
function setNumber(id, v) {
  const e = el[id];
  if (e) e.value = v == null ? "" : String(v);
}
function setRange(id, outId, v, fallback = 5) {
  const e = el[id];
  if (!e) return;
  const val = v == null ? fallback : v;
  e.value = String(val);
  const out = el[outId];
  if (out) out.textContent = String(val);
}

function syncToggleWrap(toggleId, wrapId, shouldClear) {
  const t = el[toggleId];
  const w = el[wrapId];
  if (!t || !w) return;
  w.hidden = !t.checked;
  if (!t.checked && shouldClear && el[shouldClear]) el[shouldClear].value = "";
}

/* ---------- open / close ---------- */

export function openCheckinModal(dateKey, existingEntry) {
  currentDateKey = dateKey;

  const e = existingEntry || null;

  // sleep
  if (el.checkinBedTime) el.checkinBedTime.value = e?.sleep?.bedTime || "";
  if (el.checkinWakeTime) el.checkinWakeTime.value = e?.sleep?.wakeTime || "";
  setNumber("checkinSleepHours", e?.sleep?.hours ?? null);
  setRange("checkinSleepQuality", "checkinSleepQualityValue", e?.sleep?.quality ?? null, 5);

  // routine
  setCheckbox("checkinRoutineDone", e?.relaxationRoutine?.done);
  setNumber("checkinRoutineSteps", e?.relaxationRoutine?.steps ?? null);
  setRange(
    "checkinRoutineEffectiveness",
    "checkinRoutineEffectivenessValue",
    e?.relaxationRoutine?.effectiveness ?? null,
    5,
  );
  syncToggleWrap("checkinRoutineDone", "checkinRoutineStepsWrap", "checkinRoutineSteps");

  // mood
  setRange("checkinMood", "checkinMoodValue", e?.mood?.rating ?? null, 5);
  setRange("checkinStress", "checkinStressValue", e?.mood?.stress ?? null, 5);
  setRange("checkinEnergy", "checkinEnergyValue", e?.mood?.energy ?? null, 5);

  // activities
  const a1 = e?.activity1;
  if (el.checkinActivity1) el.checkinActivity1.checked = a1 === true;
  const o1 = e?.operation1;
  if (el.checkinOperation1) el.checkinOperation1.checked = o1 === true;

  // exercise
  setCheckbox("checkinExerciseDone", e?.exercise?.done);
  setNumber("checkinExerciseMinutes", e?.exercise?.minutes ?? null);
  syncToggleWrap("checkinExerciseDone", "checkinExerciseMinutesWrap", "checkinExerciseMinutes");

  // masturbation
  setCheckbox("checkinMasturbationPos", e?.masturbation?.positive?.done);
  setNumber("checkinMasturbationPosCount", e?.masturbation?.positive?.count ?? null);
  syncToggleWrap("checkinMasturbationPos", "checkinMasturbationPosCountWrap", "checkinMasturbationPosCount");
  setCheckbox("checkinMasturbationNeg", e?.masturbation?.negative?.done);
  setNumber("checkinMasturbationNegCount", e?.masturbation?.negative?.count ?? null);
  syncToggleWrap("checkinMasturbationNeg", "checkinMasturbationNegCountWrap", "checkinMasturbationNegCount");

  // food
  setNumber("checkinFoodMeals", e?.food?.meals ?? null);
  setRange("checkinFoodQuality", "checkinFoodQualityValue", e?.food?.quality ?? null, 5);
  setCheckbox("checkinFoodWater", e?.food?.water);

  // yesterday + notes
  setRange("checkinYesterdayQuality", "checkinYesterdayQualityValue", e?.yesterdayQuality ?? null, 5);
  if (el.checkinNotes) el.checkinNotes.value = e?.notes || "";

  // reset visibility for optional fields
  if (el.checkinRoutineStepsWrap) el.checkinRoutineStepsWrap.hidden = !e?.relaxationRoutine?.done;
  if (el.checkinExerciseMinutesWrap) el.checkinExerciseMinutesWrap.hidden = !e?.exercise?.done;
  if (el.checkinMasturbationPosCountWrap)
    el.checkinMasturbationPosCountWrap.hidden = !e?.masturbation?.positive?.done;
  if (el.checkinMasturbationNegCountWrap)
    el.checkinMasturbationNegCountWrap.hidden = !e?.masturbation?.negative?.done;

  const modal = el.checkinModal;
  if (modal) {
    modal.hidden = false;
    modal.setAttribute("aria-hidden", "false");
  }
}

export function closeCheckinModal() {
  const modal = el.checkinModal;
  if (modal) {
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
  }
}

export function getCheckinDateKey() {
  return currentDateKey;
}

/* ---------- read ---------- */

export function readCheckinForm() {
  const bedTime = strOrNull(el.checkinBedTime?.value);
  const wakeTime = strOrNull(el.checkinWakeTime?.value);

  const hoursRaw = numOrNull(el.checkinSleepHours?.value);
  const hours = hoursRaw == null ? computeSleepHours(bedTime || "", wakeTime || "") : hoursRaw;

  const posDone = !!el.checkinMasturbationPos?.checked;
  const negDone = !!el.checkinMasturbationNeg?.checked;
  const exDone = !!el.checkinExerciseDone?.checked;
  const routineDone = !!el.checkinRoutineDone?.checked;

  return {
    sleep: {
      bedTime,
      wakeTime,
      hours: hours == null ? null : Math.round(hours * 10) / 10,
      quality: intOrNull(el.checkinSleepQuality?.value),
    },
    relaxationRoutine: {
      done: routineDone,
      steps: routineDone ? intOrNull(el.checkinRoutineSteps?.value) : null,
      effectiveness: intOrNull(el.checkinRoutineEffectiveness?.value),
    },
    mood: {
      rating: intOrNull(el.checkinMood?.value),
      stress: intOrNull(el.checkinStress?.value),
      energy: intOrNull(el.checkinEnergy?.value),
    },
    activity1: el.checkinActivity1 ? !!el.checkinActivity1.checked : null,
    operation1: el.checkinOperation1 ? !!el.checkinOperation1.checked : null,
    masturbation: {
      positive: {
        done: posDone,
        count: posDone ? intOrNull(el.checkinMasturbationPosCount?.value) : null,
      },
      negative: {
        done: negDone,
        count: negDone ? intOrNull(el.checkinMasturbationNegCount?.value) : null,
      },
    },
    food: {
      meals: intOrNull(el.checkinFoodMeals?.value),
      quality: intOrNull(el.checkinFoodQuality?.value),
      water: !!el.checkinFoodWater?.checked,
    },
    yesterdayQuality: intOrNull(el.checkinYesterdayQuality?.value),
    exercise: {
      done: exDone,
      minutes: exDone ? intOrNull(el.checkinExerciseMinutes?.value) : null,
    },
    notes: strOrNull(el.checkinNotes?.value),
  };
}
