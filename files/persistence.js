/* =============================================================
   persistence.js

   Connects Application State to the real JSON file.

   Save pipeline:  Read -> Validate -> Modify -> Serialize -> Save
     1. serialize the in-memory document
     2. parse + validate our own output (never write what we couldn't read back)
     3. write (browser swaps the file atomically on close)
     4. read the file back and compare
   A failed step leaves the previous file content untouched.

   The file is never written on timer ticks — only on data events
   (start / pause / resume / finish / reset / settings / plan / import).

   Local backup:
     Independently of any connected file, every data event also mirrors
     state.doc into localStorage, synchronously. That copy is what keeps
     settings / study plan / sessions alive across a reload — even a reload
     that happens in the middle of a file write (dev servers with live
     reload do exactly that). On startup the backup and the file are
     reconciled: if the backup holds newer changes that never reached the
     file, the backup wins and is written to the file.
   ============================================================= */

import { state, onDataChange, replaceDocument, commit, todayKey, tr } from "./state.js";
import {
  DEFAULT_FILE_NAME,
  DataError,
  createEmptyDocument,
  parseDocument,
  serializeDocument,
} from "./dataLayer.js";
import { FileStorage } from "./fileStorage.js";

const SAVE_DEBOUNCE_MS = 500;
const RETRY_MS = 10000;
const LOCAL_BACKUP_KEY = "study-timer:local-backup";

let handle = null; // connected file
let pendingHandle = null; // remembered file that needs a permission click
let saveTimer = null;
let chain = Promise.resolve();
let backupOk = false; // true while the localStorage mirror is known to work

const hooks = {
  onStatus: () => {},
  onMessage: () => {}, // (i18nKey, tone, detail)
  onLoaded: () => {}, // document was replaced (file load / import / clear)
};

function setStatus(status, error = null) {
  state.file.status = status;
  state.file.error = error;
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

function hasMeaningfulData() {
  const { sessions, studyPlan } = state.doc;
  return sessions.length > 0 || !!studyPlan.startDate || !!studyPlan.examDate;
}

/* ------------------------------------------------------------
   Local backup (localStorage)

   Best-effort only: wrapped in try/catch because this can throw in
   private-browsing modes or when storage is full/disabled. Never
   blocks or fails the rest of the app when it doesn't work.
   ------------------------------------------------------------ */

function probeLocalStorage() {
  try {
    const key = `${LOCAL_BACKUP_KEY}:probe`;
    localStorage.setItem(key, "1");
    localStorage.removeItem(key);
    return true;
  } catch {
    return false;
  }
}

function backupToLocalStorage() {
  try {
    localStorage.setItem(LOCAL_BACKUP_KEY, serializeDocument(state.doc));
    backupOk = true;
  } catch (err) {
    backupOk = false;
    console.warn("Could not write local backup:", err);
  }
}

function readLocalBackup() {
  try {
    return localStorage.getItem(LOCAL_BACKUP_KEY);
  } catch (err) {
    console.warn("Could not read local backup:", err);
    return null;
  }
}

function clearLocalBackup() {
  try {
    localStorage.removeItem(LOCAL_BACKUP_KEY);
  } catch {
    /* ignore */
  }
}

/**
 * What a document "says", ignoring bookkeeping that changes on every
 * serialization (app.updatedAt) and anything derived. Two documents with
 * the same signature are the same data.
 */
function contentSignature(doc) {
  return JSON.stringify({
    settings: doc.settings,
    studyPlan: doc.studyPlan,
    subjects: doc.subjects,
    sessions: doc.sessions.map(({ derived, ...rest }) => rest),
  });
}

/**
 * Load the local backup into state.doc, if one exists and is valid.
 * Returns a small snapshot { signature, updatedAt } for later comparison
 * with the file (a snapshot, because state.doc keeps changing), or null.
 */
function restoreLocalBackupIfAny() {
  const raw = readLocalBackup();
  if (!raw) return null;
  try {
    const doc = parseDocument(raw);
    const snapshot = { signature: contentSignature(doc), updatedAt: Date.parse(doc.app.updatedAt) };
    replaceDocument(doc);
    return snapshot;
  } catch (err) {
    console.warn("Local backup was invalid, ignoring it:", err);
    return null;
  }
}

/** True when the backup has real changes the file doesn't have, and is newer. */
function backupHasNewerChanges(backup, fileDoc) {
  if (!backup) return false;
  if (backup.signature === contentSignature(fileDoc)) return false; // same data → nothing to rescue
  return backup.updatedAt > Date.parse(fileDoc.app.updatedAt);
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
    const previousStatus = state.file.status;

    try {
      if (!(await FileStorage.ensurePermission(handle, false))) {
        setStatus("permission");
        return false;
      }

      setStatus("saving");
      const rev = state.rev;

      const text = serializeDocument(state.doc);
      parseDocument(text); // validate our own output before touching the file
      await FileStorage.writeText(handle, text);

      const readBack = await FileStorage.readText(handle);
      if (readBack !== text) throw new Error("Write verification failed");

      state.file.lastSavedAt = new Date().toISOString();
      if (state.rev === rev) {
        state.file.dirty = false;
        setStatus("saved");
      } else {
        setStatus("unsaved"); // data changed while saving
        schedule(0);
      }
      return true;
    } catch (err) {
      console.error("Save failed:", err);
      setStatus("error", err && err.message ? err.message : String(err));
      if (previousStatus !== "error") {
        hooks.onMessage("toastSaveFailed", "error", err && err.message);
      }
      schedule(RETRY_MS);
      return false;
    }
  });
}

onDataChange((reason, immediate) => {
  state.file.dirty = true;
  backupToLocalStorage(); // always mirrored, whether or not a file is connected

  if (!handle) {
    hooks.onStatus();
    return;
  }
  if (state.file.status === "permission") {
    hooks.onStatus();
    return; // can't save until the user grants access again
  }
  if (state.file.status !== "saving") setStatus("unsaved");
  schedule(immediate ? 0 : SAVE_DEBOUNCE_MS);
});

/* ------------------------------------------------------------
   Connect / load
   ------------------------------------------------------------ */

async function attach(h) {
  handle = h;
  pendingHandle = null;
  state.file.name = h.name;
  await FileStorage.saveHandle(h);
}

function reportPickerError(err) {
  if (err && err.name === "AbortError") return false; // user cancelled
  console.error(err);
  hooks.onMessage("toastReadFailed", "error", err && err.message);
  return false;
}

/**
 * `backup` is only passed when resuming the remembered file at startup.
 * If the local backup has newer changes than the file (the page was reloaded
 * before a save finished), the backup is kept and written to the file instead
 * of being thrown away.
 */
async function loadFromHandle(h, { confirmReplace = true, backup = null } = {}) {
  let text;
  try {
    if (!(await FileStorage.ensurePermission(h, true))) {
      hooks.onMessage("toastNoPermission", "error");
      return false;
    }
    text = await FileStorage.readText(h);
  } catch (err) {
    console.error(err);
    hooks.onMessage("toastReadFailed", "error", err && err.message);
    return false;
  }

  // Empty file (e.g. just created): adopt it and write the current data into it.
  if (!text.trim()) {
    await attach(h);
    state.file.dirty = true;
    const ok = await saveNow();
    if (ok) hooks.onMessage("toastFileCreated", "success");
    return ok;
  }

  // Existing file: never overwrite it before it has been read and validated.
  let doc;
  try {
    doc = parseDocument(text);
  } catch (err) {
    console.error("Invalid data file:", err);
    const detail = err instanceof DataError ? err.details[0] : err.message;
    hooks.onMessage("toastInvalid", "error", detail);
    return false;
  }

  // Reload during a save: the in-memory document (restored from the backup)
  // is newer than the file. Keep it and push it into the file.
  if (backupHasNewerChanges(backup, doc)) {
    await attach(h);
    state.file.dirty = true;
    state.file.lastSavedAt = null;
    setStatus("unsaved");
    schedule(0);
    hooks.onLoaded();
    return true;
  }

  if (confirmReplace && hasMeaningfulData() && !confirm(tr().confirmReplace)) {
    return false;
  }

  await attach(h);
  replaceDocument(doc);
  state.file.dirty = false;
  state.file.lastSavedAt = null;
  setStatus("saved");
  backupToLocalStorage(); // keep the backup in sync with what's now on disk
  hooks.onMessage("toastFileLoaded", "success");
  hooks.onLoaded();
  return true;
}

/* ------------------------------------------------------------
   Public API
   ------------------------------------------------------------ */

export const Persistence = {
  hooks,

  isConnected() {
    return !!handle;
  },

  async init() {
    state.file.supported = FileStorage.isSupported();
    backupOk = probeLocalStorage();

    // Restore whatever was last in memory (settings, study plan, sessions)
    // before we even try to reach a connected file — a reload should never
    // silently drop data the user already entered.
    const backup = restoreLocalBackupIfAny();

    if (!state.file.supported) {
      setStatus("unsupported");
      return "unsupported";
    }

    const remembered = await FileStorage.loadHandle();
    if (!remembered) {
      setStatus("disconnected");
      return "disconnected";
    }

    try {
      if (await FileStorage.ensurePermission(remembered, false)) {
        // The file is the source of truth once we can actually read it —
        // unless the backup has newer, unsaved changes (see loadFromHandle).
        // confirmReplace stays off here since this is just resuming the
        // same session, not a user-initiated switch to a different file.
        const ok = await loadFromHandle(remembered, { confirmReplace: false, backup });
        if (ok) return "loaded";
        setStatus("disconnected");
        return "disconnected";
      }
    } catch (err) {
      console.error(err);
    }

    pendingHandle = remembered;
    setStatus("permission");
    return "permission";
  },

  /** Save-as / create. If the picked file already has data, it is loaded, not overwritten. */
  async createFile() {
    if (!FileStorage.isSupported()) {
      hooks.onMessage("toastNoFileApi", "error");
      return false;
    }
    let h;
    try {
      h = await FileStorage.pickSaveFile(DEFAULT_FILE_NAME);
    } catch (err) {
      return reportPickerError(err);
    }
    return loadFromHandle(h);
  },

  async openFile() {
    if (!FileStorage.isSupported()) {
      hooks.onMessage("toastNoFileApi", "error");
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
      hooks.onMessage("toastNoPermission", "error");
      return false;
    }
    if (pendingHandle) return loadFromHandle(pendingHandle);
    return this.createFile();
  },

  /** Main "Create / Connect" button. */
  connect() {
    if (state.file.status === "permission") return this.reconnect();
    return this.createFile();
  },

  saveNow,

  /** Best-effort flush for visibilitychange / pagehide. */
  flush() {
    backupToLocalStorage();
    if (handle && state.file.dirty && state.file.status !== "permission") saveNow();
  },

  /**
   * Should the browser warn before leaving? Only when there is data that
   * would really be lost. Every change is mirrored to localStorage
   * synchronously and reconciled on the next start, so as long as that
   * mirror works a reload or closing the tab loses nothing — no prompt.
   */
  hasUnsavedData() {
    if (backupOk) return false;
    return handle ? state.file.dirty : state.doc.sessions.length > 0;
  },

  exportData() {
    const text = serializeDocument(state.doc);
    FileStorage.downloadText(`study-data-${todayKey()}.json`, text);
    hooks.onMessage("toastExported", "success");
  },

  importText(text) {
    let doc;
    try {
      doc = parseDocument(text);
    } catch (err) {
      console.error("Invalid import file:", err);
      const detail = err instanceof DataError ? err.details[0] : err.message;
      hooks.onMessage("toastInvalid", "error", detail);
      return false;
    }

    if (hasMeaningfulData() && !confirm(tr().confirmReplace)) return false;

    replaceDocument(doc);
    commit("import", { immediate: true }); // also writes into the connected file (and local backup)
    hooks.onLoaded();
    hooks.onMessage("toastImported", "success");
    return true;
  },

  clearAllData() {
    replaceDocument(createEmptyDocument());
    commit("clear", { immediate: true });
    clearLocalBackup();
    hooks.onLoaded();
    hooks.onMessage("toastCleared", "success");
  },
};
