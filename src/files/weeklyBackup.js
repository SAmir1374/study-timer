/* =============================================================
   weeklyBackup.js

   Best-effort weekly snapshot of weekly-plans.json into the
   connected backup directory.

   Writes at most ONE file for each local calendar week.

   Week definition:
     Saturday -> Friday

   Example:
     weekly-plan-2026-09-19-to-2026-09-25.json

   The filename itself identifies the week, so localStorage is
   NOT used to decide whether this week's backup exists.

   The backup is checked periodically while the tab is open.
   ============================================================= */

import { FileStorage } from "./fileStorage.js";

let WEEKLY_BACKUP_DIR_HANDLE_KEY = "weeklyBackupDirectory";

let dirHandle = null;
let pendingDirHandle = null;
let verifiedForWeek = null;

const hooks = {
  onStatus: () => {},
  onMessage: () => {},
};

const status = {
  supported: false,
  state: "disconnected",
  name: null,
  currentWeek: null,
};

function setStatus(nextState) {
  if (nextState) status.state = nextState;
  status.name = dirHandle ? dirHandle.name : null;
  status.currentWeek = getCurrentWeekKey();
  hooks.onStatus();
}

/* ------------------------------------------------------------
   Date helpers
   ------------------------------------------------------------ */

function formatDate(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

/**
 * Returns the Saturday -> Friday week containing the given date.
 *
 * JS getDay():
 *   Sunday    = 0
 *   Monday    = 1
 *   ...
 *   Saturday  = 6
 */
function getWeekRange(date = new Date()) {
  const current = new Date(date.getFullYear(), date.getMonth(), date.getDate());

  const day = current.getDay();

  // Distance from current day back to Saturday.
  const daysFromSaturday = (day + 1) % 7;

  const start = new Date(current);
  start.setDate(current.getDate() - daysFromSaturday);

  const end = new Date(start);
  end.setDate(start.getDate() + 6);

  return {
    start,
    end,
    startKey: formatDate(start),
    endKey: formatDate(end),
  };
}

function getCurrentWeekKey() {
  const { startKey, endKey } = getWeekRange();
  return `${startKey}-to-${endKey}`;
}

function getBackupFileName() {
  const { startKey, endKey } = getWeekRange();

  return `weekly-plan-${startKey}-to-${endKey}.json`;
}

/* ------------------------------------------------------------
   Public API
   ------------------------------------------------------------ */

export const WeeklyBackup = {
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

    const remembered = await FileStorage.loadHandle(WEEKLY_BACKUP_DIR_HANDLE_KEY);

    if (!remembered) {
      setStatus("disconnected");
      return "disconnected";
    }

    if (await FileStorage.ensureDirectoryPermission(remembered, false)) {
      dirHandle = remembered;
      verifiedForWeek = null;
      setStatus("connected");
      return "connected";
    }

    pendingDirHandle = remembered;
    setStatus("permission");
    return "permission";
  },

  /**
   * Must be called from a user gesture.
   *
   * Uses the same backup directory as DailyBackup.
   */
  async connect() {
    if (pendingDirHandle) {
      if (await FileStorage.ensureDirectoryPermission(pendingDirHandle, true)) {
        dirHandle = pendingDirHandle;
        pendingDirHandle = null;
        verifiedForWeek = null;
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
      verifiedForWeek = null;

      await FileStorage.saveHandle(h, WEEKLY_BACKUP_DIR_HANDLE_KEY);

      setStatus("connected");
      return true;
    } catch (err) {
      if (err && err.name === "AbortError") return false;

      console.error("Could not connect weekly backup directory:", err);

      hooks.onMessage("toastReadFailed", "error", err && err.message);

      return false;
    }
  },

  /**
   * Call this periodically.
   *
   * getText:
   *   Function returning the complete serialized weekly-plans JSON.
   *
   * The function is only called when this week's backup does not
   * already exist.
   */
  async maybeBackup(getText) {
    if (!dirHandle) return false;

    const weekKey = getCurrentWeekKey();

    /*
     * Fast path:
     * We already confirmed that this week's backup exists during
     * this application session.
     */
    if (verifiedForWeek === weekKey) return false;

    if (!(await FileStorage.ensureDirectoryPermission(dirHandle, false))) {
      setStatus("permission");
      return false;
    }

    try {
      const fileName = getBackupFileName();

      const exists = await FileStorage.fileExistsInDirectory(dirHandle, fileName);

      if (!exists) {
        const text = getText();

        await FileStorage.writeTextToDirectory(dirHandle, fileName, text);
      }

      verifiedForWeek = weekKey;
      setStatus("connected");

      return true;
    } catch (err) {
      console.error("Weekly backup failed:", err);

      hooks.onMessage("toastBackupFailed", "error", err && err.message);

      return false;
    }
  },

  /**
   * Useful for debugging / UI.
   */
  getCurrentWeek() {
    return getWeekRange();
  },

  getCurrentFileName() {
    return getBackupFileName();
  },
};
