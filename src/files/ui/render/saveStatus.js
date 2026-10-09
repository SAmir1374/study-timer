/* "Saved / Saving / Not connected…" indicators for the two storage files. */

import { state, tr } from '../../state.js';
import { WeeklyPlanStore } from '../../weeklyPlanStore.js';
import { el } from '../elements.js';
import { setText } from './textCache.js';

const STATUS_KEYS = {
  unsupported: 'saveUnsupported',
  disconnected: 'saveNotConnected',
  permission: 'savePermission',
  saved: 'saveSaved',
  saving: 'saveSaving',
  unsaved: 'saveUnsaved',
  error: 'saveError',
};

const SHOW_NAME_FOR = ['saved', 'saving', 'unsaved'];

function paint(container, textNode, { status, name, error }) {
  const t = tr();

  let text = t[STATUS_KEYS[status]] || t.saveNotConnected;
  if (name && SHOW_NAME_FOR.includes(status)) text += ` · ${name}`;

  container.dataset.status = status;
  container.title = error || '';
  setText(textNode, text);
}

export function saveStatus() {
  if (!el.saveStatus) return;
  const f = state.file;
  paint(el.saveStatus, el.saveStatusText, { status: f.status, name: f.name, error: f.error });
}

export function weeklyPlanStatus() {
  if (!el.weeklyPlanSaveStatus) return;
  const f = WeeklyPlanStore.status;
  paint(el.weeklyPlanSaveStatus, el.weeklyPlanSaveStatusText, {
    status: f.state,
    name: f.name,
    error: f.error,
  });
}
