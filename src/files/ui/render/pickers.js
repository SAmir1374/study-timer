/* Duration presets, subject chips and the study/practice/test kind switch. */

import { state, tr, getDisplayedKind } from '../../state.js';
import { el } from '../elements.js';

const PRESET_MINUTES = [25, 50, 90, 120];

export function presets() {
  const minutes = Math.round(state.session.durationMs / 60000);
  const isPreset = PRESET_MINUTES.includes(minutes);

  el.presetGroup.querySelectorAll('.preset-btn').forEach((btn) => {
    const active =
      btn.id === 'customPresetBtn' ? !isPreset : Number(btn.dataset.minutes) === minutes;
    btn.classList.toggle('is-active', active);
  });

  el.customDuration.hidden = isPreset;
  if (!isPreset) el.customMinutes.value = minutes;
}

/** Rebuilds the subject chip picker from doc.subjects. */
export function subjects() {
  if (!el.subjectGrid) return;

  const t = tr();
  const current = state.session.subject;

  const makeChip = (label, value) => {
    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'subject-chip' + (current === value ? ' is-active' : '');
    btn.textContent = label;
    btn.dataset.subject = value || '';
    return btn;
  };

  el.subjectGrid.innerHTML = '';
  el.subjectGrid.appendChild(makeChip(t.noSubject, null));
  state.doc.subjects.forEach((subject) => {
    el.subjectGrid.appendChild(makeChip(subject.name, subject.name));
  });
}

/** Study / Practice-test / Test-analysis switch. */
export function kind() {
  if (!el.kindGrid) return;

  const displayed = getDisplayedKind();
  el.kindGrid.querySelectorAll('.kind-btn').forEach((btn) => {
    btn.classList.toggle('is-active', btn.dataset.kind === displayed);
  });
}
