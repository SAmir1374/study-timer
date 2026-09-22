/* =============================================================
   fileStorage.js

   Low-level file I/O only. No app state, no UI.

   - File System Access API
   - File handles are remembered in IndexedDB
   - Supports multiple independent remembered handles
   ============================================================= */

const DB_NAME = "study-timer-file-handles";
const STORE = "handles";
const KEY = "dataFile";

export const WEEKLY_PLANS_HANDLE_KEY = "weeklyPlansFile";

const FILE_TYPES = [
  {
    description: "JSON files",
    accept: {
      "application/json": [".json"],
    },
  },
];

/* ------------------------------------------------------------
   IndexedDB
   ------------------------------------------------------------ */

function openDb() {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);

    req.onupgradeneeded = () => {
      if (!req.result.objectStoreNames.contains(STORE)) {
        req.result.createObjectStore(STORE);
      }
    };

    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore(mode, run) {
  const db = await openDb();

  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction(STORE, mode);
      const store = tx.objectStore(STORE);
      const req = run(store);

      tx.oncomplete = () => {
        resolve(req ? req.result : undefined);
      };

      tx.onerror = () => {
        reject(tx.error);
      };

      tx.onabort = () => {
        reject(tx.error);
      };
    });
  } finally {
    db.close();
  }
}

/* ------------------------------------------------------------
   Public API
   ------------------------------------------------------------ */

export const FileStorage = {
  /**
   * General File System Access API support.
   */
  isSupported() {
    return (
      typeof window !== "undefined" &&
      window.isSecureContext === true &&
      typeof window.showSaveFilePicker === "function" &&
      typeof window.showOpenFilePicker === "function"
    );
  },

  /**
   * Save picker support.
   */
  canSave() {
    return (
      typeof window !== "undefined" &&
      window.isSecureContext === true &&
      typeof window.showSaveFilePicker === "function"
    );
  },

  /**
   * Open picker support.
   */
  canOpen() {
    return (
      typeof window !== "undefined" &&
      window.isSecureContext === true &&
      typeof window.showOpenFilePicker === "function"
    );
  },

  /**
   * Create / connect a file.
   */
  async pickSaveFile(suggestedName) {
    if (!this.canSave()) {
      throw new Error(
        "File System Access API save picker is not supported in this browser/context.",
      );
    }

    return window.showSaveFilePicker({
      suggestedName,
      types: FILE_TYPES,
      excludeAcceptAllOption: false,
    });
  },

  /**
   * Open an existing file.
   */
  async pickOpenFile() {
    if (!this.canOpen()) {
      throw new Error(
        "File System Access API open picker is not supported in this browser/context.",
      );
    }

    const [handle] = await window.showOpenFilePicker({
      types: FILE_TYPES,
      multiple: false,
    });

    return handle;
  },

  /**
   * request=true must be called from a user gesture.
   */
  async ensurePermission(handle, request = false) {
    if (!handle) return false;

    const opts = {
      mode: "readwrite",
    };

    try {
      const current = await handle.queryPermission(opts);

      if (current === "granted") {
        return true;
      }

      if (!request) {
        return false;
      }

      const requested = await handle.requestPermission(opts);

      return requested === "granted";
    } catch (err) {
      console.error("Could not determine file permission:", err);
      return false;
    }
  },

  /**
   * Read a text file.
   */
  async readText(handle) {
    if (!handle) {
      throw new Error("No file handle available.");
    }

    const file = await handle.getFile();

    return file.text();
  },

  /**
   * Write text atomically.
   */
  async writeText(handle, text) {
    if (!handle) {
      throw new Error("No file handle available.");
    }

    const writable = await handle.createWritable();

    try {
      await writable.write(text);
      await writable.close();
    } catch (err) {
      try {
        await writable.abort();
      } catch {
        // Ignore abort failure.
      }

      throw err;
    }
  },

  /**
   * Remember a file handle.
   */
  async saveHandle(handle, key = KEY) {
    try {
      await withStore("readwrite", (store) => {
        return store.put(handle, key);
      });
    } catch (err) {
      console.warn("Could not remember file handle:", err);
    }
  },

  /**
   * Restore a remembered file handle.
   */
  async loadHandle(key = KEY) {
    try {
      return (
        (await withStore("readonly", (store) => {
          return store.get(key);
        })) || null
      );
    } catch (err) {
      console.warn("Could not load remembered file handle:", err);
      return null;
    }
  },

  /**
   * Forget a remembered file handle.
   */
  async clearHandle(key = KEY) {
    try {
      await withStore("readwrite", (store) => {
        return store.delete(key);
      });
    } catch {
      // Ignore.
    }
  },

  /**
   * Browser download fallback.
   */
  downloadText(filename, text) {
    const blob = new Blob([text], {
      type: "application/json",
    });

    const url = URL.createObjectURL(blob);

    const a = document.createElement("a");

    a.href = url;
    a.download = filename;

    document.body.appendChild(a);
    a.click();
    a.remove();

    setTimeout(() => {
      URL.revokeObjectURL(url);
    }, 1000);
  },
};