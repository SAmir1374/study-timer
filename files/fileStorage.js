/* =============================================================
   fileStorage.js

   Low-level file I/O only. No app state, no UI.

   - File System Access API (Chrome / Edge / Opera, secure context)
   - The *file handle* (not the data) is remembered in IndexedDB so the
     same file can be re-opened after a reload. The data itself lives
     only in the JSON file.
   ============================================================= */

const DB_NAME = "study-timer-file-handles";
const STORE = "handles";
const KEY = "dataFile";

const FILE_TYPES = [
  {
    description: "Study data (JSON)",
    accept: { "application/json": [".json"] },
  },
];

/* ------------------------------------------------------------
   IndexedDB (handle only)
   ------------------------------------------------------------ */

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, run) {
  const db = await openDb();
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const req = run(tx.objectStore(STORE));
      tx.oncomplete = () => resolve(req ? req.result : undefined);
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error);
    });
  } finally {
    db.close();
  }
}

/* ------------------------------------------------------------
   Public API
   ------------------------------------------------------------ */

export const FileStorage = {
  isSupported() {
    return (
      typeof window !== "undefined" &&
      window.isSecureContext &&
      "showSaveFilePicker" in window &&
      "showOpenFilePicker" in window
    );
  },

  async pickSaveFile(suggestedName) {
    return window.showSaveFilePicker({ suggestedName, types: FILE_TYPES });
  },

  async pickOpenFile() {
    const [handle] = await window.showOpenFilePicker({ types: FILE_TYPES, multiple: false });
    return handle;
  },

  /** request=true must be called from a user gesture. */
  async ensurePermission(handle, request = false) {
    const opts = { mode: "readwrite" };
    if ((await handle.queryPermission(opts)) === "granted") return true;
    if (request && (await handle.requestPermission(opts)) === "granted") return true;
    return false;
  },

  async readText(handle) {
    const file = await handle.getFile();
    return file.text();
  },

  /**
   * The browser writes to a temporary swap file and only replaces the real
   * file on close(), so a failed write leaves the previous content intact.
   */
  async writeText(handle, text) {
    const writable = await handle.createWritable();
    try {
      await writable.write(text);
      await writable.close();
    } catch (err) {
      try {
        await writable.abort();
      } catch {
        /* ignore */
      }
      throw err;
    }
  },

  async saveHandle(handle) {
    try {
      await withStore("readwrite", (s) => s.put(handle, KEY));
    } catch (err) {
      console.warn("Could not remember the data file handle:", err);
    }
  },

  async loadHandle() {
    try {
      return (await withStore("readonly", (s) => s.get(KEY))) || null;
    } catch {
      return null;
    }
  },

  async clearHandle() {
    try {
      await withStore("readwrite", (s) => s.delete(KEY));
    } catch {
      /* ignore */
    }
  },

  /** Export fallback that works in every browser. */
  downloadText(filename, text) {
    const blob = new Blob([text], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  },
};
