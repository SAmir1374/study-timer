/* =============================================================
   analytics/view/fileLoader.js — read-only loading of study-data.json.

   Never writes the study-data file. Opening a file here also stores
   its handle, so the timer page remembers the same file.
   ============================================================= */

import { DataError, parseDocument } from '../../dataLayer.js';
import { FileStorage } from '../../fileStorage.js';
import { el } from './elements.js';
import { tr } from './prefs.js';
import { renderAnalytics } from './render.js';
import { store } from './store.js';
import { showToast } from './toast.js';

function showConnected() {
  el.connectSection.hidden = true;
  el.contentSection.hidden = false;
  el.refreshBtn.hidden = !store.handle;
}

/** Parses text into a document; shows a toast and returns null when invalid. */
function parseOrToast(text) {
  try {
    return parseDocument(text);
  } catch (err) {
    console.error('Invalid data file:', err);
    const detail = err instanceof DataError ? err.details[0] : err.message;
    showToast(detail || tr().invalidFile, 'error');
    return null;
  }
}

function show(doc, handle) {
  store.handle = handle;
  store.doc = doc;
  el.fileNameLabel.textContent = handle?.name || '';
  showConnected();
  renderAnalytics(doc);
}

export async function readAndRender(handle) {
  let text;
  try {
    text = await FileStorage.readText(handle);
  } catch (err) {
    console.error(err);
    showToast(tr().readFailed, 'error');
    return false;
  }

  const doc = parseOrToast(text);
  if (!doc) return false;

  show(doc, handle);
  return true;
}

/** Imported snapshot only: no handle, so nothing to refresh against. */
export function importText(text) {
  const doc = parseOrToast(text);
  if (doc) show(doc, null);
}

export async function pickAndOpen() {
  let handle;
  try {
    handle = await FileStorage.pickOpenFile();
  } catch (err) {
    if (err && err.name === 'AbortError') return; // user cancelled
    console.error(err);
    showToast(tr().readFailed, 'error');
    return;
  }

  try {
    if (!(await FileStorage.ensurePermission(handle, true))) {
      showToast(tr().noPermission, 'error');
      return;
    }
  } catch (err) {
    console.error(err);
    showToast(tr().readFailed, 'error');
    return;
  }

  if (await readAndRender(handle)) {
    await FileStorage.saveHandle(handle); // share the remembered file with the timer page
  }
}

export async function refresh() {
  if (!store.handle) return;

  try {
    if (!(await FileStorage.ensurePermission(store.handle, false))) {
      showToast(tr().noPermission, 'error');
      return;
    }
  } catch (err) {
    console.error(err);
    return;
  }

  if (await readAndRender(store.handle)) showToast(tr().refreshed, 'success');
}
