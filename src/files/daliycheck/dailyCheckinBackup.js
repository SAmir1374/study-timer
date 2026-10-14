/* =============================================================
   dailyCheckinBackup.js — daily snapshot of daily-checkins.json
   Same interface as DailyBackup.js but a separate folder handle.
   ============================================================= */

import { FileStorage } from '../fileStorage.js';
import { serializeCheckinDocument } from './dailyCheckinData.js';

const HANDLE_KEY = 'study-timer:daily-checkins-backup-handle';
const LAST_KEY = 'study-timer:daily-checkins-backup-last';
const RETRY_AFTER_FAIL_MS = 10 * 60 * 1000;

let dirHandle = null;
let backupInFlight = false;
let lastFailAt = 0;

// تاریخ محلی (هماهنگ با dateKey چک‌این‌ها)
function localDateKey() {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

export const DailyCheckinBackup = {
  hooks: { onMessage: () => {} },

  async init() {
    if (!FileStorage.canSave()) return 'unsupported';
    const remembered = await FileStorage.loadHandle(HANDLE_KEY);
    if (!remembered) return 'disconnected';
    try {
      if (await FileStorage.ensurePermission(remembered, false)) {
        dirHandle = remembered;
        return 'ready';
      }
    } catch (err) {
      console.warn(err);
    }
    return 'permission';
  },

  async connect() {
    if (!FileStorage.canPickDirectory()) return false;
    try {
      const h = await FileStorage.pickDirectory();
      dirHandle = h;
      await FileStorage.saveHandle(h, HANDLE_KEY);
      return true;
    } catch (err) {
      if (err?.name !== 'AbortError') console.error(err);
      return false;
    }
  },

  isConnected() {
    return !!dirHandle;
  },

  async maybeBackup(getDoc) {
    if (!dirHandle) return false;
    if (backupInFlight) return false;
    if (Date.now() - lastFailAt < RETRY_AFTER_FAIL_MS) return false;

    const today = localDateKey();
    if (localStorage.getItem(LAST_KEY) === today) return false;

    const doc = getDoc();
    if (!doc?.entries?.length) return false; // بکاپ خالی نساز

    backupInFlight = true;
    try {
      if (!(await FileStorage.ensurePermission(dirHandle, false))) return false;

      const name = `daily-checkins-${today}.json`;
      const text = serializeCheckinDocument(doc);
      const fileHandle = await dirHandle.getFileHandle(name, { create: true });
      const writable = await fileHandle.createWritable();
      await writable.write(text);
      await writable.close();

      // اول پرچم، بعد هر اعلان دیگری
      localStorage.setItem(LAST_KEY, today);
      return true;
    } catch (err) {
      console.error('Checkin backup failed:', err);
      lastFailAt = Date.now(); // به‌جای غیرفعال‌کردن کل روز، ۱۰ دقیقه بعد دوباره
      return false;
    } finally {
      backupInFlight = false;
    }
  },
};
