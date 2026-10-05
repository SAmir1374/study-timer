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
export const BACKUP_DIR_HANDLE_KEY = "backupDirectory";

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
   * Directory picker support (used for the daily-backup folder).
   */
  canPickDirectory() {
    return (
      typeof window !== "undefined" &&
      window.isSecureContext === true &&
      typeof window.showDirectoryPicker === "function"
    );
  },

  /**
   * Create / connect a file.
   */
  async pickSaveFile(suggestedName) {
    if (!this.canSave()) {
      throw new Error("File System Access API save picker is not supported in this browser/context.");
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
      throw new Error("File System Access API open picker is not supported in this browser/context.");
    }

    const [handle] = await window.showOpenFilePicker({
      types: FILE_TYPES,
      multiple: false,
    });

    return handle;
  },

  /**
   * Pick a directory to use as the daily-backup destination.
   */
  async pickDirectory() {
    if (!this.canPickDirectory()) {
      throw new Error("Directory picker is not supported in this browser/context.");
    }

    return window.showDirectoryPicker({ mode: "readwrite" });
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
   * Same as ensurePermission(), but for a directory handle
   * (FileSystemDirectoryHandle uses the same permission API shape).
   * request=true must be called from a user gesture.
   */
  async ensureDirectoryPermission(dirHandle, request = false) {
    if (!dirHandle) return false;

    const opts = {
      mode: "readwrite",
    };

    try {
      const current = await dirHandle.queryPermission(opts);

      if (current === "granted") {
        return true;
      }

      if (!request) {
        return false;
      }

      const requested = await dirHandle.requestPermission(opts);

      return requested === "granted";
    } catch (err) {
      console.error("Could not determine directory permission:", err);
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

    try {
      const file = await handle.getFile();

      return await file.text();
    } catch (err) {
      if (err?.name === "NotFoundError") {
        const error = new Error("The remembered file no longer exists or has been moved.");

        error.name = "FileHandleNotFoundError";

        throw error;
      }

      throw err;
    }
  },

  /**
   * Write text atomically.
   */
  async writeText(handle, text) {
    if (!handle) {
      throw new Error("No file handle available.");
    }

    let writable;

    try {
      writable = await handle.createWritable();

      await writable.write(text);
      await writable.close();
    } catch (err) {
      try {
        await writable?.abort();
      } catch {
        // Ignore abort failure.
      }

      if (err?.name === "NotFoundError") {
        throw new Error("The remembered file no longer exists or has been moved.");
      }

      throw err;
    }
  },

  /**
   * Write text to fileName inside a directory handle, creating the
   * file if it doesn't exist yet. Used for daily backup snapshots.
   */
  async writeTextToDirectory(dirHandle, fileName, text) {
    if (!dirHandle) {
      throw new Error("No directory handle available.");
    }

    const fileHandle = await dirHandle.getFileHandle(fileName, { create: true });
    const writable = await fileHandle.createWritable();

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
   * Check whether fileName already exists inside dirHandle, without
   * creating it. Used to avoid overwriting today's backup twice.
   */
  async fileExistsInDirectory(dirHandle, fileName) {
    if (!dirHandle) return false;

    try {
      await dirHandle.getFileHandle(fileName, { create: false });
      return true;
    } catch {
      return false;
    }
  },

  /**
   * Remember a file (or directory) handle.
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
   * Restore a remembered file (or directory) handle.
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
   * Forget a remembered file (or directory) handle.
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
