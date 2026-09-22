/* =============================================================
   weeklyPlanStore.js

   Connects the in-memory weekly-plans document to weekly-plans.json.
   Fully independent of study-timer.json / persistence.js / state.js —
   the only link between the two systems is studyPlan.weeklyPlanSource
   (a filename string, set by app.js when a weekly-plans file connects;
   see dataLayer.js and state.js's setWeeklyPlanSource()).

   Deliberately simpler than persistence.js: weekly plans are edited
   by hand occasionally, not mutated every second by a running timer,
   so the debounce/backup-reconciliation machinery persistence.js has
   (to survive a save racing a live-reload) isn't needed here. A plain
   "mirror to localStorage on every change, restore it at startup" is
   enough. Same save pipeline otherwise: validate our own output before
   writing, read the file back and compare.
   ============================================================= */

import {
  DEFAULT_WEEKLY_PLANS_FILE_NAME,
  createEmptyWeeklyPlansDocument,
  parseWeeklyPlansDocument,
  serializeWeeklyPlansDocument,
} from './weeklyPlanData.js';
import { DataError } from './dataLayer.js';
import { FileStorage, WEEKLY_PLANS_HANDLE_KEY } from './fileStorage.js';

const LOCAL_BACKUP_KEY = 'study-timer:weekly-plans-backup';
const SAVE_DEBOUNCE_MS = 500;
const RETRY_MS = 10000;

let doc = createEmptyWeeklyPlansDocument();
let handle = null; // connected file
let pendingHandle = null; // remembered file that needs a permission click
let saveTimer = null;
let chain = Promise.resolve();
let dirty = false;

const hooks = {
  onStatus: () => {},
  onMessage: () => {}, // (i18nKey, tone, detail) — reuses study-timer.json's toast* keys, see summary
  onLoaded: () => {}, // document was replaced (file load / import)
};

/** Read-only snapshot for callers (app.js reads status.name to set weeklyPlanSource). */
const status = { supported: false, name: null, state: 'disconnected', error: null };

function setStatus(next, error = null) {
  status.state = next;
  status.error = error;
  hooks.onStatus();
}

function enqueue(task) {
  const run = chain.then(task);
  chain = run.catch(() => {});
  return run;
}

function schedule(delay) {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    saveNow();
  }, delay);
}

/* ------------------------------------------------------------
   Local backup (localStorage) — best-effort, same try/catch
   discipline as persistence.js's version.
   ------------------------------------------------------------ */

function backupToLocalStorage() {
  try {
    localStorage.setItem(LOCAL_BACKUP_KEY, serializeWeeklyPlansDocument(doc));
  } catch (err) {
    console.warn('Could not write weekly-plans local backup:', err);
  }
}

function restoreLocalBackupIfAny() {
  try {
    const raw = localStorage.getItem(LOCAL_BACKUP_KEY);
    if (!raw) return false;
    doc = parseWeeklyPlansDocument(raw);
    return true;
  } catch (err) {
    console.warn('Weekly-plans local backup was invalid, ignoring it:', err);
    return false;
  }
}

function markChanged(immediate = false) {
  dirty = true;
  backupToLocalStorage();
  if (!handle) {
    hooks.onStatus();
    return;
  }
  if (status.state === 'permission') {
    hooks.onStatus();
    return;
  }
  if (status.state !== 'saving') setStatus('unsaved');
  schedule(immediate ? 0 : SAVE_DEBOUNCE_MS);
}

/* ------------------------------------------------------------
   Save
   ------------------------------------------------------------ */

function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!handle) return Promise.resolve(false);

  return enqueue(async () => {
    if (!handle) return false;
    try {
      if (!(await FileStorage.ensurePermission(handle, false))) {
        setStatus('permission');
        return false;
      }

      setStatus('saving');
      const text = serializeWeeklyPlansDocument(doc);
      parseWeeklyPlansDocument(text); // validate our own output before touching the file
      await FileStorage.writeText(handle, text);

      const readBack = await FileStorage.readText(handle);
      if (readBack !== text) throw new Error('Write verification failed');

      dirty = false;
      setStatus('saved');
      return true;
    } catch (err) {
      console.error('Weekly plans save failed:', err);
      setStatus('error', err && err.message ? err.message : String(err));
      hooks.onMessage('toastSaveFailed', 'error', err && err.message);
      schedule(RETRY_MS);
      return false;
    }
  });
}

/* ------------------------------------------------------------
   Connect / load
   ------------------------------------------------------------ */

async function attach(h) {
  handle = h;
  pendingHandle = null;
  status.name = h.name;
  await FileStorage.saveHandle(h, WEEKLY_PLANS_HANDLE_KEY);
}

function reportPickerError(err) {
  if (err && err.name === 'AbortError') return false; // user cancelled
  console.error(err);
  hooks.onMessage('toastReadFailed', 'error', err && err.message);
  return false;
}

async function loadFromHandle(h, { confirmReplace = true } = {}) {
  let text = '';

  try {
    if (!(await FileStorage.ensurePermission(h, true))) {
      hooks.onMessage('toastNoPermission', 'error');
      return false;
    }

    try {
      text = await FileStorage.readText(h);
    } catch (readError) {
      /*
       * A newly selected save file can be treated as empty if the
       * browser does not expose its contents immediately.
       */
      console.warn('Could not read selected weekly-plans file. Treating it as empty:', readError);

      text = '';
    }
  } catch (err) {
    console.error(err);

    hooks.onMessage('toastReadFailed', 'error', err && err.message ? err.message : String(err));

    return false;
  }

  /*
   * New / empty file
   */
  if (!text.trim()) {
    await attach(h);

    dirty = true;

    const ok = await saveNow();

    if (ok) {
      hooks.onMessage('toastFileCreated', 'success');
      hooks.onLoaded();
    }

    return ok;
  }

  /*
   * Existing file:
   * NEVER overwrite before validating it.
   */
  let loaded;

  try {
    loaded = parseWeeklyPlansDocument(text);
  } catch (err) {
    console.error('Invalid weekly plans file:', err);

    const detail = err instanceof DataError ? err.details?.[0] : err?.message || String(err);

    hooks.onMessage('toastInvalid', 'error', detail);

    return false;
  }

  if (confirmReplace && doc.plans.length > 0) {
    const ok = confirm(
      'The weekly plans currently in memory will be replaced by the ones from this file. Continue?'
    );

    if (!ok) {
      return false;
    }
  }

  await attach(h);

  doc = loaded;
  dirty = false;

  setStatus('saved');

  backupToLocalStorage();

  hooks.onMessage('toastFileLoaded', 'success');
  hooks.onLoaded();

  return true;
}

/* ------------------------------------------------------------
   Public API — mirrors Persistence's shape (connect/openFile/saveNow/
   exportData/importText/flush/hasUnsavedData) so the two are easy to
   wire up the same way once there's UI for this.
   ------------------------------------------------------------ */

export const WeeklyPlanStore = {
  hooks,
  status,

  isConnected() {
    return !!handle;
  },

  /** The in-memory weekly-plans document. Treat as read-only; use upsertPlan/removePlan to mutate. */
  getDoc() {
    return doc;
  },

  getPlans() {
    return doc.plans;
  },

  async init() {
    status.supported = FileStorage.canSave() || FileStorage.canOpen();

    restoreLocalBackupIfAny();

    if (!status.supported) {
      setStatus('unsupported');
      return 'unsupported';
    }

    const remembered = await FileStorage.loadHandle(WEEKLY_PLANS_HANDLE_KEY);

    if (!remembered) {
      setStatus('disconnected');
      return 'disconnected';
    }

    try {
      if (await FileStorage.ensurePermission(remembered, false)) {
        const ok = await loadFromHandle(remembered, {
          confirmReplace: false,
        });

        if (ok) {
          return 'loaded';
        }

        setStatus('disconnected');
        return 'disconnected';
      }
    } catch (err) {
      console.error(err);
    }

    pendingHandle = remembered;

    setStatus('permission');

    return 'permission';
  },

  /** Save-as / create. If the picked file already has data, it is loaded, not overwritten. */
  async createFile() {
    if (!FileStorage.canSave()) {
      hooks.onMessage('toastNoFileApi', 'error');
      return false;
    }

    let h;

    try {
      h = await FileStorage.pickSaveFile(DEFAULT_WEEKLY_PLANS_FILE_NAME);
    } catch (err) {
      return reportPickerError(err);
    }

    return loadFromHandle(h);
  },

  async openFile() {
    if (!FileStorage.isSupported()) {
      hooks.onMessage('toastNoFileApi', 'error');
      return false;
    }
    let h;
    try {
      h = await FileStorage.pickOpenFile();
    } catch (err) {
      return reportPickerError(err);
    }
    return loadFromHandle(h);
  },

  /** Re-grant access to a remembered/connected file (needs a user click). */
  async reconnect() {
    if (handle) {
      if (await FileStorage.ensurePermission(handle, true)) return saveNow();
      hooks.onMessage('toastNoPermission', 'error');
      return false;
    }
    if (pendingHandle) return loadFromHandle(pendingHandle);
    return this.createFile();
  },

  connect() {
    return status.state === 'permission' ? this.reconnect() : this.createFile();
  },

  saveNow,

  /** Best-effort flush for visibilitychange / pagehide. */
  flush() {
    backupToLocalStorage();
    if (handle && dirty && status.state !== 'permission') saveNow();
  },

  hasUnsavedData() {
    return handle ? dirty : doc.plans.length > 0;
  },

  exportData() {
    const text = serializeWeeklyPlansDocument(doc);
    FileStorage.downloadText(DEFAULT_WEEKLY_PLANS_FILE_NAME, text);
    hooks.onMessage('toastExported', 'success');
  },

  importText(text) {
    let loaded;
    try {
      loaded = parseWeeklyPlansDocument(text);
    } catch (err) {
      console.error('Invalid weekly plans import:', err);
      const detail = err instanceof DataError ? err.details[0] : err.message;
      hooks.onMessage('toastInvalid', 'error', detail);
      return false;
    }
    if (doc.plans.length > 0) {
      const ok = confirm(
        'The weekly plans currently in memory will be replaced by the imported ones. Continue?'
      );
      if (!ok) return false;
    }
    doc = loaded;
    markChanged(true);
    hooks.onLoaded();
    hooks.onMessage('toastImported', 'success');
    return true;
  },

  /** Adds a new plan, or replaces an existing one with the same id (e.g. re-saving "2026-W38"). */
  upsertPlan(plan) {
    const idx = doc.plans.findIndex((p) => p.id === plan.id);
    if (idx === -1) doc.plans.push(plan);
    else doc.plans[idx] = plan;
    markChanged(true);
  },

  removePlan(id) {
    doc.plans = doc.plans.filter((p) => p.id !== id);
    markChanged(true);
  },
};
