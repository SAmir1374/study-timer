/* Daily check-in modal (sleep, routine, exercise…). */

import { el } from '../elements.js';
import { readOptionalNumber } from '../formUtils.js';

let dateKey = null;

/** Opens the modal; pre-fills the form when an entry already exists for the day. */
export function openCheckinModal(key, existingEntry = null) {
  if (!el.checkinModal) return;
  dateKey = key;

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

  dateKey = null;
  el.checkinModal.hidden = true;
  el.checkinModal.setAttribute('aria-hidden', 'true');
}

export const getCheckinDateKey = () => dateKey;

/** Reads the form. Returns null when any filled value is invalid. */
export function readCheckinForm() {
  const hours = readOptionalNumber(el.checkinSleepHours, { min: 0, max: 24 });
  const routineSteps = readOptionalNumber(el.checkinRoutineSteps, { max: 100, integer: true });
  const exerciseMinutes = readOptionalNumber(el.checkinExerciseMinutes, { max: 600, integer: true });

  if (!hours.ok || !routineSteps.ok || !exerciseMinutes.ok) return null;

  const routineDone = el.checkinRoutineDone.checked;
  const exerciseDone = el.checkinExerciseDone.checked;

  return {
    sleep: {
      bedTime: el.checkinBedTime.value || null,
      wakeTime: el.checkinWakeTime.value || null,
      hours: hours.value,
      quality: Number(el.checkinSleepQuality.value),
    },
    relaxationRoutine: {
      done: routineDone,
      steps: routineDone ? routineSteps.value : null,
    },
    activity1: el.checkinActivity1.checked,
    operation1: el.checkinOperation1.checked,
    yesterdayQuality: Number(el.checkinYesterdayQuality.value),
    exercise: {
      done: exerciseDone,
      minutes: exerciseDone ? exerciseMinutes.value : null,
    },
  };
}
