/* =============================================================
   dailyBackup.js

   Best-effort daily snapshot of study-data.json into a connected
   backup directory. Writes at most ONE file per local Gregorian
   calendar day, named study-data-YYYY-MM-DD.json.

   Deliberately independent of persistence.js: it doesn't hook into
   the save pipeline, it just checks "has today's snapshot been
   written yet?" every time app.js's periodic tick calls maybeBackup().
   That means it only runs while the tab is open — for guaranteed
   backups even when the browser is closed, pair this with an
   OS-level scheduled copy of the real file.
   ============================================================= */

import { FileStorage, BACKUP_DIR_HANDLE_KEY } from "./fileStorage.js";

const LAST_BACKUP_KEY = "study-timer:last-backup-date"; // "YYYY-MM-DD", Gregorian

let dirHandle = null;
let pendingDirHandle = null; // remembered but needs a permission click
let verifiedForDate = null; // date we've already confirmed today's file exists on disk for

const hooks = {
  onStatus: () => {},
  onMessage: () => {}, // (i18nKey, tone, detail)
};

const status = {
  supported: false,
  state: "disconnected", // 'unsupported' | 'disconnected' | 'permission' | 'connected'
  name: null,
  lastBackupDate: null,
};

function setStatus(nextState) {
  if (nextState) status.state = nextState;
  status.name = dirHandle ? dirHandle.name : null;
  status.lastBackupDate = localStorage.getItem(LAST_BACKUP_KEY);
  hooks.onStatus();
}

export const DailyBackup = {
  hooks,
  status,

  isConnected() {
    return !!dirHandle;
  },

  async init() {
    status.supported = FileStorage.canPickDirectory();
    if (!status.supported) {
      setStatus("unsupported");
      return "unsupported";
    }

    const remembered = await FileStorage.loadHandle(BACKUP_DIR_HANDLE_KEY);
    if (!remembered) {
      setStatus("disconnected");
      return "disconnected";
    }

    if (await FileStorage.ensureDirectoryPermission(remembered, false)) {
      dirHandle = remembered;
      setStatus("connected");
      return "connected";
    }

    pendingDirHandle = remembered;
    setStatus("permission");
    return "permission";
  },

  /** Must be called from a user gesture (button click). */
  async connect() {
    if (pendingDirHandle) {
      if (await FileStorage.ensureDirectoryPermission(pendingDirHandle, true)) {
        dirHandle = pendingDirHandle;
        pendingDirHandle = null;
        verifiedForDate = null; // force a fresh existence check in this (re)connected folder
        setStatus("connected");
        return true;
      }
      hooks.onMessage("toastNoPermission", "error");
      return false;
    }

    try {
      const h = await FileStorage.pickDirectory();
      if (!(await FileStorage.ensureDirectoryPermission(h, true))) {
        hooks.onMessage("toastNoPermission", "error");
        return false;
      }
      dirHandle = h;
      verifiedForDate = null; // force a fresh existence check in this newly connected folder
      await FileStorage.saveHandle(h, BACKUP_DIR_HANDLE_KEY);
      setStatus("connected");
      return true;
    } catch (err) {
      if (err && err.name === "AbortError") return false; // user cancelled
      console.error("Could not connect backup directory:", err);
      hooks.onMessage("toastReadFailed", "error", err && err.message);
      return false;
    }
  },

  /**
   * Call this often (e.g. every second, from app.js's existing tick).
   * `getText` is a function returning the JSON text to snapshot — it's
   * only called if a backup is actually needed today, so this stays cheap.
   * `todayKeyFn` is a function returning today's local "YYYY-MM-DD" (Gregorian).
   */
  async maybeBackup(getText, todayKeyFn) {
    if (!dirHandle) return false;

    const today = todayKeyFn();

    // Fast path: we've already confirmed on THIS run that today's file is on
    // disk, so skip the disk check every second. This cache resets whenever
    // the date changes or the app restarts, so a deleted/missing file still
    // gets caught (and recreated) at least once per session/day.
    if (verifiedForDate === today) return false;

    if (!(await FileStorage.ensureDirectoryPermission(dirHandle, false))) {
      setStatus("permission");
      return false; // will retry automatically once permission is granted again
    }

    try {
      const fileName = `study-data-${today}.json`;
      const exists = await FileStorage.fileExistsInDirectory(dirHandle, fileName);

      if (!exists) {
        // Either never written today, or it was written and then deleted —
        // either way, (re)create it. Never trust localStorage's flag alone.
        await FileStorage.writeTextToDirectory(dirHandle, fileName, getText());
      }

      localStorage.setItem(LAST_BACKUP_KEY, today);
      verifiedForDate = today;
      setStatus("connected");
      return true;
    } catch (err) {
      console.error("Daily backup failed:", err);
      hooks.onMessage("toastBackupFailed", "error", err && err.message);
      return false;
    }
  },
};
