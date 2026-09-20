/* =============================================================
   app.js  (entry point)
   Wires DOM events -> TimerEngine / state / Persistence.
   ============================================================= */

import {
  state,
  tr,
  setSelectedMinutes,
  setSelectedSubject,
  addSubject,
  removeSubject,
  updateSettings,
} from './state.js';
import { TimerEngine } from './timer.js';
import { Persistence } from './persistence.js';
import {
  el,
  Render,
  renderTranslations,
  setLanguage,
  openSettings,
  closeSettings,
  applySettingsFromForm,
  populateSettingsForm,
  renderSubjectManageList,
  applyTheme,
  applyReducedMotion,
  applyLanguageAttributes,
  toggleFullscreen,
  showToast,
  openConnectModal,
  closeConnectModal,
  isAnyModalOpen,
} from './ui.js';

/* ============================================================
   Main loop
   ============================================================ */

let rafId = null;

function loop() {
  TimerEngine.checkCompletion();
  Render.timer();
  Render.stats();

  rafId = state.session.state === 'running' ? requestAnimationFrame(loop) : null;
}

function ensureLoop() {
  if (state.session.state === 'running' && rafId == null) {
    rafId = requestAnimationFrame(loop);
  }
}

/* Slow loop: live clock, idle rendering, and completion checks while the
   tab is in the background (requestAnimationFrame is paused there). */
setInterval(() => {
  TimerEngine.checkCompletion();
  Render.clock();
  if (state.session.state !== 'running') {
    Render.timer();
    Render.stats();
  }
}, 1000);

TimerEngine.onChange = () => {
  Render.all();
  ensureLoop();
};

/* ============================================================
   Persistence hooks
   ============================================================ */

Persistence.hooks.onStatus = () => Render.saveStatus();

Persistence.hooks.onMessage = (key, tone, detail) => {
  const text = tr()[key] || key;
  showToast(detail ? `${text} — ${detail}` : text, tone);
};

Persistence.hooks.onLoaded = () => {
  closeConnectModal();
  applyDocumentToUI();
};

/** Apply everything that depends on the loaded document. */
function applyDocumentToUI() {
  applyTheme();
  applyReducedMotion();
  applyLanguageAttributes();
  renderTranslations();
  populateSettingsForm(); // also rebuilds the Settings → Subjects chip list
  TimerEngine.recover();
  Render.all();
  ensureLoop();
}

/* ============================================================
   Timer controls
   ============================================================ */

el.primaryBtn.addEventListener('click', () => {
  TimerEngine.toggle();
  ensureLoop();
  Render.all();
});

el.resetBtn.addEventListener('click', () => {
  const s = state.session.state;
  if ((s === 'running' || s === 'paused') && !confirm(tr().confirmReset)) return;
  TimerEngine.reset();
  Render.all();
});

el.finishBtn.addEventListener('click', () => {
  TimerEngine.finish(false);
  Render.all();
});

el.breakBtn.addEventListener('click', () => {
  if (state.session.type === 'break') {
    TimerEngine.reset();
  } else {
    if (state.session.state === 'running' || state.session.state === 'paused') return;
    TimerEngine.start(5 * 60 * 1000, 'break');
    ensureLoop();
  }
  Render.all();
});

/* ============================================================
   Language / theme / fullscreen
   ============================================================ */

el.langFaBtn.addEventListener('click', () => setLanguage('fa'));
el.langEnBtn.addEventListener('click', () => setLanguage('en'));

el.themeToggle.addEventListener('click', () => {
  updateSettings({ theme: state.doc.settings.theme === 'dark' ? 'light' : 'dark' });
  applyTheme();
});

el.fullscreenToggle.addEventListener('click', () => toggleFullscreen());

/* ============================================================
   Subject picker
   ============================================================ */

el.subjectGrid?.addEventListener('click', (event) => {
  const btn = event.target.closest('.subject-chip');
  if (!btn || state.session.state !== 'idle') return;

  setSelectedSubject(btn.dataset.subject || null);
  Render.all();
});

/* ============================================================
   Presets / custom duration / study window
   ============================================================ */

el.presetGroup.addEventListener('click', (event) => {
  const btn = event.target.closest('.preset-btn');
  if (!btn || state.session.state !== 'idle') return;

  if (btn.id === 'customPresetBtn') {
    el.customDuration.hidden = false;
    el.customMinutes.focus();
    return;
  }

  const minutes = Number(btn.dataset.minutes);
  if (!minutes || minutes <= 0) return;

  el.customDuration.hidden = true;
  setSelectedMinutes(minutes);
  Render.all();
});

el.customMinutes.addEventListener('change', () => {
  if (state.session.state !== 'idle') return;
  let minutes = Math.round(Number(el.customMinutes.value));
  if (!minutes || minutes < 1) return;
  minutes = Math.min(600, Math.max(1, minutes));
  setSelectedMinutes(minutes);
  Render.all();
});

el.applyWindowBtn.addEventListener('click', () => {
  if (!el.windowStart.value || !el.windowEnd.value) return;

  const [sh, sm] = el.windowStart.value.split(':').map(Number);
  const [eh, em] = el.windowEnd.value.split(':').map(Number);

  const startMin = sh * 60 + sm;
  let endMin = eh * 60 + em;
  if (endMin <= startMin) endMin += 24 * 60; // window crosses midnight

  const minutes = endMin - startMin;
  if (minutes <= 0 || minutes > 1440 || state.session.state !== 'idle') return;

  setSelectedMinutes(minutes);
  Render.all();
});

/* ============================================================
   Settings modal
   ============================================================ */

el.settingsToggle.addEventListener('click', () => openSettings());
el.settingsCloseBtn?.addEventListener('click', () => closeSettings());
el.settingsModal
  .querySelector('[data-close-settings]')
  ?.addEventListener('click', () => closeSettings());

el.saveSettingsBtn?.addEventListener('click', () => {
  if (applySettingsFromForm({ showErrors: true })) closeSettings();
});

[
  el.settingGoalHours,
  el.settingDefaultMinutes,
  el.settingSound,
  el.settingClock24,
  el.settingReducedMotion,
  el.settingAutoStart,
].forEach((input) => {
  input.addEventListener('change', () => applySettingsFromForm());
});

/* Settings -> Subjects (add / remove) */

function submitNewSubject() {
  if (addSubject(el.newSubjectInput.value)) {
    el.newSubjectInput.value = '';
    renderSubjectManageList();
    Render.all(); // refresh the subject picker on the main page too
  }
  el.newSubjectInput.focus();
}

el.addSubjectBtn?.addEventListener('click', () => submitNewSubject());

el.newSubjectInput?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    e.preventDefault();
    submitNewSubject();
  }
});

el.subjectManageList?.addEventListener('click', (event) => {
  const btn = event.target.closest('.subject-manage-chip__remove');
  if (!btn) return;
  removeSubject(btn.dataset.subject);
  renderSubjectManageList();
  Render.all();
});

/* ============================================================
   Data file: connect / open / save / export / import / clear
   ============================================================ */

el.connectFileBtn?.addEventListener('click', () => Persistence.connect());
el.openFileBtn?.addEventListener('click', () => Persistence.openFile());

el.saveNowBtn?.addEventListener('click', async () => {
  if (!Persistence.isConnected()) {
    showToast(tr().toastNoFile, 'error');
    return;
  }
  if (await Persistence.saveNow()) showToast(tr().toastSaved, 'success');
});

el.exportBtn?.addEventListener('click', () => Persistence.exportData());

el.importFileInput?.addEventListener('change', async () => {
  const file = el.importFileInput.files && el.importFileInput.files[0];
  if (!file) return;
  try {
    Persistence.importText(await file.text());
  } catch (err) {
    console.error(err);
    showToast(tr().toastReadFailed, 'error');
  } finally {
    el.importFileInput.value = '';
  }
});

el.clearDataBtn?.addEventListener('click', () => {
  if (!confirm(tr().confirmClear)) return;
  TimerEngine.reset(); // closes any running session cleanly first
  Persistence.clearAllData();
});

/* Connect modal (shown at startup when no file is connected) */

el.connectCloseBtn?.addEventListener('click', () => closeConnectModal());
el.connectLaterBtn?.addEventListener('click', () => closeConnectModal());
el.connectModal
  .querySelector('[data-close-connect]')
  ?.addEventListener('click', () => closeConnectModal());

el.connectNowBtn?.addEventListener('click', async () => {
  if (await Persistence.connect()) closeConnectModal();
});

el.connectOpenBtn?.addEventListener('click', async () => {
  if (await Persistence.openFile()) closeConnectModal();
});

/* Clickable save-status indicator */

if (el.saveStatus) {
  el.saveStatus.setAttribute('role', 'button');
  el.saveStatus.tabIndex = 0;

  const onStatusActivate = () => {
    switch (state.file.status) {
      case 'permission':
        Persistence.connect();
        break;
      case 'error':
      case 'unsaved':
        Persistence.saveNow();
        break;
      case 'disconnected':
        openConnectModal();
        break;
      case 'unsupported':
        showToast(tr().toastNoFileApi, 'error');
        break;
      default:
    }
  };

  el.saveStatus.addEventListener('click', onStatusActivate);
  el.saveStatus.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      onStatusActivate();
    }
  });
}

/* ============================================================
   Keyboard shortcuts
   ============================================================ */

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') {
    if (!el.settingsModal.hidden) return closeSettings();
    if (!el.connectModal.hidden) return closeConnectModal();
  }

  const target = event.target;
  const tag = target && target.tagName ? target.tagName : '';
  const typing = tag === 'INPUT' || tag === 'TEXTAREA' || target?.isContentEditable;
  if (typing || isAnyModalOpen()) return;

  if (event.code === 'Space') {
    event.preventDefault();
    TimerEngine.toggle();
    ensureLoop();
    Render.all();
    return;
  }

  if (event.key === 'r' || event.key === 'R') {
    event.preventDefault();
    el.resetBtn.click();
    return;
  }

  if (event.key === 'f' || event.key === 'F') {
    event.preventDefault();
    toggleFullscreen();
  }
});

/* ============================================================
   Page lifecycle
   ============================================================ */

document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'hidden') {
    Persistence.flush();
    return;
  }
  TimerEngine.checkCompletion();
  Render.clock();
  Render.timer();
  Render.stats();
  ensureLoop();
});

window.addEventListener('pagehide', () => Persistence.flush());

/* Warn before leaving when data exists only in memory / isn't saved yet. */
window.addEventListener('beforeunload', (event) => {
  Persistence.flush();
  if (Persistence.hasUnsavedData()) {
    event.preventDefault();
    event.returnValue = '';
  }
});

/* ============================================================
   Init
   ============================================================ */

async function init() {
  applyDocumentToUI(); // immediate first paint with defaults

  const result = await Persistence.init(); // may load a file -> onLoaded re-applies

  if (result === 'unsupported') {
    showToast(tr().toastNoFileApi, 'info');
  } else if (result !== 'loaded') {
    openConnectModal();
  }
  Render.all();
}

init();

export { init, loop, ensureLoop };
