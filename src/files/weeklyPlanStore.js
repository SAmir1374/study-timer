/* =============================================================
   weeklyPlanStore.js
   Connects the in-memory weekly-plans document (the phased master
   plan: phases → weeks → days) to weekly-plans.json.
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
  INVALID_WEEKLY_PLANS_MESSAGE,
  createEmptyWeeklyPlansDocument,
  findPhaseById,
  getAllWeeks,
  getWeeklyPlansValidationErrors,
  parseWeeklyPlansDocument,
  serializeWeeklyPlansDocument,
} from "./weeklyPlanData.js";
import { DataError } from "./dataLayer.js";
import { FileStorage, WEEKLY_PLANS_HANDLE_KEY } from "./fileStorage.js";
const LOCAL_BACKUP_KEY = "study-timer:weekly-plans-backup";
const SAVE_DEBOUNCE_MS = 500;
const RETRY_MS = 10000;
let doc = createEmptyWeeklyPlansDocument();
let handle = null;
let pendingHandle = null;
let saveTimer = null;
let chain = Promise.resolve();
let dirty = false;
const hooks = {
  onStatus: () => {},
  onMessage: () => {},
  onLoaded: () => {},
};
const status = {
  supported: false,
  name: null,
  state: "disconnected",
  error: null,
};
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
    void saveNow();
  }, delay);
}
function backupToLocalStorage() {
  try {
    localStorage.setItem(LOCAL_BACKUP_KEY, serializeWeeklyPlansDocument(doc));
  } catch (err) {
    console.warn("Could not write weekly-plans local backup:", err);
  }
}
function restoreLocalBackupIfAny() {
  try {
    const raw = localStorage.getItem(LOCAL_BACKUP_KEY);
    if (!raw) return false;
    doc = parseWeeklyPlansDocument(raw);
    return true;
  } catch (err) {
    console.warn("Weekly-plans local backup was invalid, ignoring it:", err);
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
  if (status.state === "permission") {
    hooks.onStatus();
    return;
  }
  if (status.state !== "saving") {
    setStatus("unsaved");
  }
  schedule(immediate ? 0 : SAVE_DEBOUNCE_MS);
}
function commitDoc(next) {
  const errors = getWeeklyPlansValidationErrors(next);
  if (errors.length > 0) {
    throw new Error(`${INVALID_WEEKLY_PLANS_MESSAGE}: ${errors.join("; ")}`);
  }
  doc = next;
  markChanged(true);
}
function saveNow() {
  clearTimeout(saveTimer);
  saveTimer = null;
  if (!handle) return Promise.resolve(false);
  return enqueue(async () => {
    if (!handle) return false;
    try {
      if (!(await FileStorage.ensurePermission(handle, false))) {
        setStatus("permission");
        return false;
      }
      setStatus("saving");
      const text = serializeWeeklyPlansDocument(doc);
      parseWeeklyPlansDocument(text);
      await FileStorage.writeText(handle, text);
      const readBack = await FileStorage.readText(handle);
      if (readBack !== text) {
        throw new Error("Write verification failed");
      }
      dirty = false;
      setStatus("saved");
      return true;
    } catch (err) {
      console.error("Weekly plans save failed:", err);
      setStatus("error", err instanceof Error ? err.message : String(err));
      hooks.onMessage("toastSaveFailed", "error", err instanceof Error ? err.message : String(err));
      schedule(RETRY_MS);
      return false;
    }
  });
}
async function attach(h) {
  handle = h;
  pendingHandle = null;
  status.name = h.name;
  await FileStorage.saveHandle(h, WEEKLY_PLANS_HANDLE_KEY);
}
function reportPickerError(err) {
  if (err?.name === "AbortError") return false;
  console.error(err);
  hooks.onMessage("toastReadFailed", "error", err instanceof Error ? err.message : String(err));
  return false;
}
async function loadFromHandle(h, { confirmReplace = true } = {}) {
  let text = "";
  try {
    if (!(await FileStorage.ensurePermission(h, true))) {
      hooks.onMessage("toastNoPermission", "error");
      return false;
    }
    try {
      text = await FileStorage.readText(h);
    } catch (readError) {
      console.warn("Could not read selected weekly-plans file. Treating it as empty:", readError);
      text = "";
    }
  } catch (err) {
    console.error(err);
    hooks.onMessage("toastReadFailed", "error", err instanceof Error ? err.message : String(err));
    return false;
  }
  if (!text.trim()) {
    await attach(h);
    dirty = true;
    const ok = await saveNow();
    if (ok) {
      hooks.onMessage("toastFileCreated", "success");
      hooks.onLoaded();
    }
    return ok;
  }
  let loaded;
  try {
    loaded = parseWeeklyPlansDocument(text);
  } catch (err) {
    console.error("Invalid weekly plans file:", err);
    const detail =
      err instanceof DataError ? err.details?.[0] : err instanceof Error ? err.message : String(err);
    hooks.onMessage("toastInvalid", "error", detail);
    return false;
  }
  if (confirmReplace && doc.phases.length > 0) {
    const ok = confirm(
      "The weekly plans currently in memory will be replaced by the ones from this file. Continue?",
    );
    if (!ok) {
      return false;
    }
  }
  await attach(h);
  doc = loaded;
  dirty = false;
  setStatus("saved");
  backupToLocalStorage();
  hooks.onMessage("toastFileLoaded", "success");
  hooks.onLoaded();
  return true;
}
export const WeeklyPlanStore = {
  hooks,
  status,
  isConnected() {
    return !!handle;
  },
  getDoc() {
    return doc;
  },
  getPhases() {
    return doc.phases;
  },
  getWeeks() {
    return getAllWeeks(doc);
  },
  hasData() {
    return doc.phases.length > 0;
  },
  async init() {
    status.supported = FileStorage.canSave() || FileStorage.canOpen();
    restoreLocalBackupIfAny();
    if (!status.supported) {
      setStatus("unsupported");
      return "unsupported";
    }
    const remembered = await FileStorage.loadHandle(WEEKLY_PLANS_HANDLE_KEY);
    if (!remembered) {
      setStatus("disconnected");
      return "disconnected";
    }
    try {
      if (await FileStorage.ensurePermission(remembered, false)) {
        const ok = await loadFromHandle(remembered, {
          confirmReplace: false,
        });
        if (ok) {
          return "loaded";
        }
        setStatus("disconnected");
        return "disconnected";
      }
    } catch (err) {
      console.error(err);
    }
    pendingHandle = remembered;
    status.name = remembered.name;
    setStatus("permission");
    return "permission";
  },
  async createFile() {
    if (!FileStorage.canSave()) {
      hooks.onMessage("toastNoFileApi", "error");
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
  async reconnect() {
    if (handle) {
      if (await FileStorage.ensurePermission(handle, true)) {
        return saveNow();
      }
      hooks.onMessage("toastNoPermission", "error");
      return false;
    }
    if (pendingHandle) {
      return loadFromHandle(pendingHandle);
    }
    return this.createFile();
  },
  connect() {
    return status.state === "permission" ? this.reconnect() : this.createFile();
  },
  saveNow,
  flush() {
    backupToLocalStorage();
    if (handle && dirty && status.state !== "permission") {
      void saveNow();
    }
  },
  hasUnsavedData() {
    return handle ? dirty : doc.phases.length > 0;
  },
  exportData() {
    const text = serializeWeeklyPlansDocument(doc);
    FileStorage.downloadText(DEFAULT_WEEKLY_PLANS_FILE_NAME, text);
    hooks.onMessage("toastExported", "success");
  },
  importText(text) {
    let loaded;
    try {
      loaded = parseWeeklyPlansDocument(text);
    } catch (err) {
      console.error("Invalid weekly plans import:", err);
      const detail =
        err instanceof DataError ? err.details?.[0] : err instanceof Error ? err.message : String(err);
      hooks.onMessage("toastInvalid", "error", detail);
      return false;
    }
    if (doc.phases.length > 0) {
      const ok = confirm(
        "The weekly plans currently in memory will be replaced by the imported ones. Continue?",
      );
      if (!ok) return false;
    }
    doc = loaded;
    markChanged(true);
    hooks.onLoaded();
    hooks.onMessage("toastImported", "success");
    return true;
  },
  upsertWeek(phaseId, week) {
    const next = structuredClone(doc);
    const phase = findPhaseById(next, phaseId);
    if (!phase) {
      throw new Error(`Unknown phase: ${phaseId}`);
    }
    const idx = phase.weeks.findIndex((w) => w.id === week.id);
    if (idx === -1) {
      phase.weeks.push(week);
    } else {
      phase.weeks[idx] = week;
    }
    commitDoc(next);
  },
  removeWeek(weekId) {
    const next = structuredClone(doc);
    for (const phase of next.phases) {
      phase.weeks = phase.weeks.filter((w) => w.id !== weekId);
    }
    commitDoc(next);
  },
};
