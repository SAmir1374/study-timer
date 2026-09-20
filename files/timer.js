/* =============================================================
   timer.js

   The timer never counts ticks. Every value (remaining, elapsed,
   active time, pause time) is computed from real timestamps stored
   in the session record, so it stays correct across throttled tabs,
   sleep, and page reloads.
   ============================================================= */

import { state, commit, rebuildSummaries } from './state.js';
import {
  activeMs,
  createSessionRecord,
  finalizeRecord,
  pauseRecord,
  remainingMsOf,
  resumeRecord,
  targetEndMs,
} from './dataLayer.js';

export const TimerEngine = {
  /** Set by app.js: re-render + make sure the animation loop is running. */
  onChange: null,
  _completeTimeout: null,

  remainingMs() {
    const s = state.session;
    if ((s.state === 'running' || s.state === 'paused') && s.record) {
      return remainingMsOf(s.record, Date.now());
    }
    if (s.state === 'complete') return Math.max(0, s.durationMs - s.finalElapsedMs);
    return s.durationMs;
  },

  elapsedMs() {
    const s = state.session;
    return Math.max(0, s.durationMs - this.remainingMs());
  },

  /**
   * subject is only used for "study" sessions (breaks are always subject:null).
   * When omitted, the currently selected subject (settings.lastSelectedSubject)
   * is used — pass it explicitly only when overriding that default.
   */
  start(durationMs, type, subject) {
    const s = state.session;
    const now = Date.now();

    if (s.state === 'idle' || s.state === 'complete') {
      clearTimeout(this._completeTimeout);
      const kind = type || 'study';
      const dur = durationMs != null ? durationMs : s.durationMs;
      const sub =
        kind === 'study'
          ? subject !== undefined
            ? subject
            : state.doc.settings.lastSelectedSubject
          : null;

      const rec = createSessionRecord({
        type: kind,
        durationSeconds: Math.round(dur / 1000),
        subject: sub,
        nowMs: now,
      });
      state.doc.sessions.push(rec);

      s.type = kind;
      s.subject = sub;
      s.durationMs = dur;
      s.record = rec;
      s.finalElapsedMs = 0;
      s.state = 'running';
      commit('sessionStart', { immediate: true });
    } else if (s.state === 'paused' && s.record) {
      resumeRecord(s.record, now);
      s.state = 'running';
      commit('sessionResume', { immediate: true });
    }
  },

  pause() {
    const s = state.session;
    if (s.state !== 'running' || !s.record) return;
    pauseRecord(s.record, Date.now());
    s.state = 'paused';
    commit('sessionPause', { immediate: true });
  },

  toggle() {
    if (state.session.state === 'running') this.pause();
    else this.start();
  },

  _toIdle() {
    const s = state.session;
    s.state = 'idle';
    s.type = 'study';
    s.subject = state.doc.settings.lastSelectedSubject;
    s.durationMs = state.doc.settings.lastSelectedMinutes * 60 * 1000;
    s.record = null;
    s.finalElapsedMs = 0;
  },

  /** Discards progress from the UI, but keeps the raw record as "cancelled". */
  reset() {
    const s = state.session;
    clearTimeout(this._completeTimeout);

    if (s.record && (s.state === 'running' || s.state === 'paused')) {
      finalizeRecord(s.record, 'cancelled', Date.now());
      rebuildSummaries();
      commit('sessionCancel', { immediate: true });
    }
    this._toIdle();
  },

  /**
   * Ends the current session.
   * - reached planned duration  -> "completed"
   * - ended earlier by the user -> "abandoned"
   */
  finish(auto = false, opts = {}) {
    const s = state.session;
    const rec = s.record;
    if (!rec || (s.state !== 'running' && s.state !== 'paused')) return;

    const now = Date.now();
    const plannedMs = rec.planned.durationSeconds * 1000;
    const reached = activeMs(rec, now) >= plannedMs;

    // If the target time already passed (e.g. page was closed), end the
    // session at the moment it really finished, not at "now".
    const endMs = reached && s.state === 'running' ? Math.min(now, targetEndMs(rec)) : now;

    const wasStudy = rec.type === 'study';
    finalizeRecord(rec, reached ? 'completed' : 'abandoned', endMs);

    s.finalElapsedMs = rec.derived.activeDurationSeconds * 1000;
    s.record = null;
    rebuildSummaries();

    if (opts.silent) {
      this._toIdle();
      commit(reached ? 'sessionRecovered' : 'sessionFinish', { immediate: true });
      this.onChange?.();
      return;
    }

    s.state = 'complete';
    commit(reached ? 'sessionComplete' : 'sessionFinish', { immediate: true });
    Sound.play(wasStudy ? 'complete' : 'breakEnd');
    this.onChange?.();

    clearTimeout(this._completeTimeout);
    this._completeTimeout = setTimeout(
      () => {
        if (state.session.state !== 'complete') return;
        this._toIdle();
        this.onChange?.();
        if (wasStudy && auto && state.doc.settings.autoStartNextSession) {
          this.start();
          this.onChange?.();
        }
      },
      wasStudy ? 3200 : 1400
    );
  },

  /** Called every tick while running to auto-complete at zero. */
  checkCompletion() {
    const s = state.session;
    if (s.state === 'running' && this.remainingMs() <= 0) {
      this.finish(true);
    }
  },

  /** Call after loading a document: closes sessions that ended while the app was closed. */
  recover() {
    const s = state.session;
    if (s.state === 'running' && s.record && this.remainingMs() <= 0) {
      this.finish(false, { silent: true });
    }
  },
};

/* ------------------------------------------------------------
   Sound
   ------------------------------------------------------------ */

export const Sound = {
  ctx: null,
  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (AC) this.ctx = new AC();
    }
    return this.ctx;
  },
  play(kind) {
    if (!state.doc.settings.soundEnabled) return;
    const ctx = this.ensure();
    if (!ctx) return;
    if (ctx.state === 'suspended') ctx.resume();
    const notes = kind === 'complete' ? [523.25, 659.25, 783.99] : [659.25, 523.25];
    const now = ctx.currentTime;
    notes.forEach((freq, i) => {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = freq;
      const t0 = now + i * 0.14;
      gain.gain.setValueAtTime(0, t0);
      gain.gain.linearRampToValueAtTime(0.14, t0 + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.5);
      osc.connect(gain).connect(ctx.destination);
      osc.start(t0);
      osc.stop(t0 + 0.55);
    });
  },
};

/* ------------------------------------------------------------
   Formatting (presentation only, never stored)
   ------------------------------------------------------------ */

export function pad(n) {
  return String(n).padStart(2, '0');
}

export function fmtHMS(ms) {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  return h > 0 ? `${pad(h)}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function fmtMS(ms) {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${pad(m)}:${pad(s)}`;
}

export function fmtHoursMinutes(totalSeconds) {
  const totalMin = Math.round(totalSeconds / 60);
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  return `${pad(h)}h ${pad(m)}m`;
}

export function fmtClock(ts) {
  const d = new Date(ts);
  const opts =
    state.doc.settings.clockFormat === '24h'
      ? { hour: '2-digit', minute: '2-digit', hour12: false }
      : { hour: 'numeric', minute: '2-digit', hour12: true };
  return d.toLocaleTimeString(undefined, opts).replace(/^24:/, '00:');
}
