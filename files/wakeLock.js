/* =============================================================
   wakeLock.js

   Keeps the screen from sleeping while a study/break session is
   running, using the Screen Wake Lock API. Best-effort only:
   unsupported browsers simply get no effect, and the OS/browser
   can release the lock on its own at any time (tab backgrounded,
   low battery, etc.) — that's why sync() is called on every
   session-state change and reacquireIfNeeded() on visibilitychange.
   ============================================================= */

export const WakeLock = {
  _sentinel: null,
  _wanted: false,

  isSupported() {
    return typeof navigator !== 'undefined' && 'wakeLock' in navigator;
  },

  async _acquire() {
    if (!this.isSupported() || this._sentinel) return;
    try {
      this._sentinel = await navigator.wakeLock.request('screen');
      this._sentinel.addEventListener('release', () => {
        this._sentinel = null;
      });
    } catch {
      // Permission denied, page not visible, low battery, etc. — fail silently.
      this._sentinel = null;
    }
  },

  async _release() {
    const s = this._sentinel;
    this._sentinel = null;
    if (s) {
      try {
        await s.release();
      } catch {
        /* already released */
      }
    }
  },

  /** Call whenever "should the screen stay awake?" changes (e.g. session running or not). */
  async sync(wanted) {
    this._wanted = wanted;
    if (wanted) await this._acquire();
    else await this._release();
  },

  /** The browser auto-releases the lock when the tab is hidden, so re-request
      it once the tab becomes visible again, if it's still supposed to be held. */
  async reacquireIfNeeded() {
    if (this._wanted && document.visibilityState === 'visible') {
      await this._acquire();
    }
  },
};
