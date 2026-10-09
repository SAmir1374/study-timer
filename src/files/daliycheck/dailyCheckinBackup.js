/* =============================================================
   dailyCheckinBackup.js — daily snapshot of daily-checkins.json
   Same interface as DailyBackup.js but a separate folder handle.
   ============================================================= */

import { FileStorage } from "../fileStorage.js";
import { serializeCheckinDocument } from "./dailyCheckinData.js";

const HANDLE_KEY = "study-timer:daily-checkins-backup-handle";
const LAST_KEY = "study-timer:daily-checkins-backup-last";

let dirHandle = null;
let backupInFlight = false; // ← این خط را اضافه کن

const d = new Date();
const today = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

export const DailyCheckinBackup = {
  hooks: { onMessage: () => {} },

  async init() {
    if (!FileStorage.canSave()) return "unsupported";
    const remembered = await FileStorage.loadHandle(HANDLE_KEY);
    if (!remembered) return "disconnected";
    try {
      if (await FileStorage.ensurePermission(remembered, false)) {
        dirHandle = remembered;
        return "ready";
      }
    } catch (err) {
      console.warn(err);
    }
    return "permission";
  },

  async connect() {
    if (!FileStorage.canPickDirectory()) return false;
    try {
      const h = await FileStorage.pickDirectory();
      dirHandle = h;
      await FileStorage.saveHandle(h, HANDLE_KEY);
      return true;
    } catch (err) {
      if (err?.name !== "AbortError") console.error(err);
      return false;
    }
  },

  isConnected() {
    return !!dirHandle;
  },

  async maybeBackup(getDoc) {
    if (!dirHandle) return false;
    if (backupInFlight) return false; // ← جدید: قفل

    const today = new Date().toISOString().slice(0, 10);
    const last = localStorage.getItem(LAST_KEY);
    if (last === today) return false;

    backupInFlight = true; // ← جدید
    try {
      if (!(await FileStorage.ensurePermission(dirHandle, false))) return false;
      const name = `daily-checkins-${today}.json`;
      const text = serializeCheckinDocument(getDoc());
      const fileHandle = await dirHandle.getFileHandle(name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(text);
      await writable.close();

      // FIRST set the flag, THEN notify
      localStorage.setItem(LAST_KEY, today);

      // Don't show toast — the interval is not the place for user-facing messages
      return true;
    } catch (err) {
      console.error("Checkin backup failed:", err);
      // On failure, wait until tomorrow (don't retry every second)
      localStorage.setItem(LAST_KEY, today);
      return false;
    } finally {
      backupInFlight = false;
    }
  },
};
