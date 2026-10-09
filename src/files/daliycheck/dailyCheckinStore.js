/* =============================================================
   dailyCheckinStore.js — connects daily-checkins.json to the app
   Same pattern as weeklyPlanStore.js.
   ============================================================= */

import {
  DEFAULT_CHECKIN_FILE_NAME,
  INVALID_CHECKIN_MESSAGE,
  CheckinDataError,
  createEmptyCheckinDocument,
  createCheckinEntry,
  findEntryByDate,
  parseCheckinDocument,
  serializeCheckinDocument,
  upsertEntry,
} from "./dailyCheckinData.js";
import { FileStorage } from "../fileStorage.js";

const LOCAL_BACKUP_KEY = "study-timer:daily-checkins-backup";
const HANDLE_KEY = "study-timer:daily-checkins-handle";
const SAVE_DEBOUNCE_MS = 400;
const RETRY_MS = 10000;

let doc = createEmptyCheckinDocument();
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
  saveTimer = setTimeout(() => void saveNow(), delay);
}

function backupToLocalStorage() {
  try {
    localStorage.setItem(LOCAL_BACKUP_KEY, serializeCheckinDocument(doc));
  } catch (err) {
    console.warn("Could not write checkins local backup:", err);
  }
}

function restoreLocalBackupIfAny() {
  try {
    const raw = localStorage.getItem(LOCAL_BACKUP_KEY);
    if (!raw) return false;
    doc = parseCheckinDocument(raw);
    return true;
  } catch (err) {
    console.warn("Checkins local backup was invalid:", err);
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
  if (status.state !== "saving") setStatus("unsaved");
  schedule(immediate ? 0 : SAVE_DEBOUNCE_MS);
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
      const text = serializeCheckinDocument(doc);
      parseCheckinDocument(text); // self-check
      await FileStorage.writeText(handle, text);
      const readBack = await FileStorage.readText(handle);
      if (readBack !== text) throw new Error("Write verification failed");
      dirty = false;
      setStatus("saved");
      return true;
    } catch (err) {
      console.error("Checkins save failed:", err);
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
  await FileStorage.saveHandle(h, HANDLE_KEY);
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
    } catch {
      text = "";
    }
  } catch (err) {
    console.error(err);
    hooks.onMessage("toastReadFailed", "error");
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
    loaded = parseCheckinDocument(text);
  } catch (err) {
    const detail =
      err instanceof CheckinDataError ? err.details?.[0] : err instanceof Error ? err.message : String(err);
    hooks.onMessage("toastInvalid", "error", detail);
    return false;
  }

  if (confirmReplace && doc.entries.length > 0) {
    if (!confirm("Check-in data in memory will be replaced. Continue?")) return false;
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

/* ------------------------------------------------------------ */

export const DailyCheckinStore = {
  hooks,
  status,

  isConnected() {
    return !!handle;
  },
  getDoc() {
    return doc;
  },
  getEntries() {
    return doc.entries;
  },
  hasEntryForDate(dateKey) {
    return !!findEntryByDate(doc, dateKey);
  },
  getEntryForDate(dateKey) {
    return findEntryByDate(doc, dateKey);
  },
  hasData() {
    return doc.entries.length > 0;
  },

  async init() {
    status.supported = FileStorage.canSave() || FileStorage.canOpen();
    restoreLocalBackupIfAny();
    if (!status.supported) {
      setStatus("unsupported");
      return "unsupported";
    }
    const remembered = await FileStorage.loadHandle(HANDLE_KEY);
    if (!remembered) {
      setStatus("disconnected");
      return "disconnected";
    }
    try {
      if (await FileStorage.ensurePermission(remembered, false)) {
        const ok = await loadFromHandle(remembered, { confirmReplace: false });
        if (ok) return "loaded";
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
      h = await FileStorage.pickSaveFile(DEFAULT_CHECKIN_FILE_NAME);
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
      if (await FileStorage.ensurePermission(handle, true)) return saveNow();
      hooks.onMessage("toastNoPermission", "error");
      return false;
    }
    if (pendingHandle) return loadFromHandle(pendingHandle);
    return this.createFile();
  },

  connect() {
    return status.state === "permission" ? this.reconnect() : this.createFile();
  },

  saveNow,
  flush() {
    backupToLocalStorage();
    if (handle && dirty && status.state !== "permission") void saveNow();
  },
  hasUnsavedData() {
    if (!handle) return false; // ← اگر وصل نیست، «کثیف» حساب نمی‌شود
    return dirty;
  },

  /** ذخیره‌ی چک‌این امروز (یا جایگزینی اگر موجود بود) */
  saveCheckin(dateKey, values) {
    const entry = createCheckinEntry(dateKey);
    Object.assign(entry, values);
    entry.date = dateKey;
    entry.recordedAt = new Date().toISOString();
    upsertEntry(doc, entry);
    markChanged(true);
    return entry;
  },

  exportData() {
    const text = serializeCheckinDocument(doc);
    FileStorage.downloadText(DEFAULT_CHECKIN_FILE_NAME, text);
    hooks.onMessage("toastExported", "success");
  },

  importText(text) {
    let loaded;
    try {
      loaded = parseCheckinDocument(text);
    } catch (err) {
      const detail =
        err instanceof CheckinDataError ? err.details?.[0] : err instanceof Error ? err.message : String(err);
      hooks.onMessage("toastInvalid", "error", detail);
      return false;
    }
    if (doc.entries.length > 0) {
      if (!confirm("Check-in data in memory will be replaced. Continue?")) return false;
    }
    doc = loaded;
    markChanged(true);
    hooks.onLoaded();
    hooks.onMessage("toastImported", "success");
    return true;
  },
};
