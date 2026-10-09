/* Settings modal: general preferences, exam plan dates, subject list. */

import { state, tr, clamp, mutateDocument, setSelectedMinutes } from '../../state.js';
import { el } from '../elements.js';
import { applyReducedMotion } from '../appearance.js';
import { Render } from '../render/index.js';
import { showToast } from '../toast.js';

/* ---------- subjects ---------- */

/** Rebuilds the removable subject chips inside Settings → Subjects. */
export function renderSubjectManageList() {
  if (!el.subjectManageList) return;

  el.subjectManageList.replaceChildren();
  const subjects = Array.isArray(state.doc.subjects) ? state.doc.subjects : [];

  subjects.forEach((subject) => {
    const name = typeof subject === 'string' ? subject : subject?.name;
    if (!name) return;

    const label = document.createElement('span');
    label.className = 'subject-manage-chip__label';
    label.textContent = name;

    const removeBtn = document.createElement('button');
    removeBtn.type = 'button';
    removeBtn.className = 'subject-manage-chip__remove';
    removeBtn.dataset.subject = name;
    removeBtn.setAttribute('aria-label', 'Remove');
    removeBtn.textContent = '×';

    const chip = document.createElement('span');
    chip.className = 'subject-manage-chip';
    chip.append(label, removeBtn);

    el.subjectManageList.appendChild(chip);
  });
}

/* ---------- form <-> state ---------- */

export function populateSettingsForm() {
  const plan = state.doc.studyPlan;

  // Stored as Gregorian "YYYY-MM-DD" — same format as <input type="date">.
  el.studyStartDate.value = plan.startDate || '';
  el.examDate.value = plan.examDate || '';
  el.totalWeeks.value = plan.totalWeeks || '';

  renderSubjectManageList();
}

export function openSettings() {
  const { settings, studyPlan } = state.doc;

  el.settingGoalHours.value = (Number(studyPlan?.dailyGoalMinutes) || 240) / 60;
  el.settingDefaultMinutes.value = Number(settings?.defaultSessionMinutes) || 50;
  el.settingSound.checked = Boolean(settings?.soundEnabled);
  el.settingClock24.checked = settings?.clockFormat === '24h';
  el.settingReducedMotion.checked = Boolean(settings?.reducedMotion);
  el.settingAutoStart.checked = Boolean(settings?.autoStartNextSession);

  populateSettingsForm();

  el.settingsModal.hidden = false;
  el.settingsModal.setAttribute('aria-hidden', 'false');
}

export function closeSettings() {
  el.settingsModal.hidden = true;
  el.settingsModal.setAttribute('aria-hidden', 'true');
}

function readPlanFromForm() {
  const weeks = Number(el.totalWeeks.value);

  return {
    startDate: el.studyStartDate.value || null,
    examDate: el.examDate.value || null,
    totalWeeks: Number.isFinite(weeks) && weeks > 0 ? Math.round(weeks) : 0,
  };
}

/** Returns an error code, or null when valid (an empty plan is valid = cleared). */
export function validatePlan(plan) {
  if (!plan.startDate && !plan.examDate && !plan.totalWeeks) return null;
  if (!plan.startDate || !plan.examDate) return 'missing';
  if (plan.examDate <= plan.startDate) return 'range';
  if (!Number.isInteger(plan.totalWeeks) || plan.totalWeeks <= 0) return 'weeks';
  return null;
}

/** Returns false when the exam plan is invalid (other settings are still saved). */
export function applySettingsFromForm({ showErrors = false } = {}) {
  const goalHours = clamp(Number(el.settingGoalHours.value) || 4, 0.5, 16);
  const defMinutes = clamp(Math.round(Number(el.settingDefaultMinutes.value) || 50), 1, 600);
  const plan = readPlanFromForm();
  const planError = validatePlan(plan);
  const previousDefault = Number(state.doc.settings.defaultSessionMinutes) || 50;

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

  if (defMinutes !== previousDefault && state.session.state === 'idle') {
    setSelectedMinutes(defMinutes);
  }

  Render.all();

  if (planError && showErrors) {
    const t = tr();
    const messages = { missing: t.planErrMissing, range: t.planErrRange, weeks: t.planErrWeeks };
    showToast(messages[planError] || t.planErrMissing, 'error');
    return false;
  }
  return true;
}
