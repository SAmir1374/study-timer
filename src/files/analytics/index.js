/* =============================================================
   analytics/index.js — entry point for analytics.html

   Read-only view over the same study-data.json used by the timer,
   plus (separately) a read-only view over weekly-plans.json via
   WeeklyPlanStore. The two files are loaded independently, exactly
   as in the timer app, so this page can show either, both or neither.

   Folder map
   ----------
   index.js             this file: event wiring + init
   data/                pure aggregation (no DOM, no storage)
     dateUtils.js         day-key math, Saturday..Friday range
     overview.js          all-time stats, subject stats, streaks
     series.js            daily / weekly / monthly series, heatmap grid
     patterns.js          hour, day-part, weekday, session-length
     examPlan.js          exam countdown + this week's study vs goal
     planAdherence.js     planned (weekly plan) vs actual (sessions)
     insights.js          rule-based insight objects
   charts/              dependency-free SVG builders (pure functions)
     svg.js bars.js line.js donut.js
   view/                everything that touches the DOM
     elements.js i18n.js prefs.js toast.js store.js format.js constants.js
     fileLoader.js        open / import / refresh study-data.json
     render.js            renderAnalytics(doc): composes the sections
     sections/            hero, kpis, heatmap, exam, subjects, trends,
                          patterns, weeklyPlan, insights
   ============================================================= */

import { FileStorage } from '../fileStorage.js';
import { WeeklyPlanStore } from '../weeklyPlanStore.js';
import { el } from './view/elements.js';
import { importText, pickAndOpen, readAndRender, refresh } from './view/fileLoader.js';
import {
  applyLanguage,
  applyTheme,
  renderTranslations,
  setLanguagePref,
  toggleThemePref,
  tr,
} from './view/prefs.js';
import { renderAnalytics } from './view/render.js';
import { store } from './view/store.js';
import { renderWeeklyPlanSection, renderWeeklyPlanStatus } from './view/sections/weeklyPlan.js';
import { showToast } from './view/toast.js';

/* ---------- language / theme ---------- */

function setLanguage(language) {
  if (language !== 'fa' && language !== 'en') return;

  setLanguagePref(language);
  applyLanguage();
  renderTranslations();

  // Re-render number/date strings + chart tooltips.
  if (store.doc) renderAnalytics(store.doc);
  else renderWeeklyPlanSection(); // plan-only view still needs refreshed labels
}

function toggleTheme() {
  toggleThemePref();
  applyTheme();
}

/* ---------- wiring ---------- */

el.langFaBtn.addEventListener('click', () => setLanguage('fa'));
el.langEnBtn.addEventListener('click', () => setLanguage('en'));
el.themeToggle.addEventListener('click', toggleTheme);

el.openFileBtn.addEventListener('click', pickAndOpen);
el.changeFileBtn.addEventListener('click', pickAndOpen);
el.refreshBtn.addEventListener('click', refresh);

el.importFileInput.addEventListener('change', async () => {
  const file = el.importFileInput.files && el.importFileInput.files[0];
  if (!file) return;

  try {
    importText(await file.text());
  } catch (err) {
    console.error(err);
    showToast(tr().readFailed, 'error');
  } finally {
    el.importFileInput.value = '';
  }
});

if (el.weeklyPlanConnectBtn) {
  el.weeklyPlanConnectBtn.addEventListener('click', () => {
    if (WeeklyPlanStore.status.state === 'permission') WeeklyPlanStore.reconnect();
    else WeeklyPlanStore.openFile();
  });
}

WeeklyPlanStore.hooks.onStatus = () => renderWeeklyPlanStatus();
WeeklyPlanStore.hooks.onMessage = (key, tone) => showToast(tr()[key] || key, tone);
WeeklyPlanStore.hooks.onLoaded = () => {
  // Plan files feed the exam status too (dates/week goal), so refresh everything.
  if (store.doc) renderAnalytics(store.doc);
  else renderWeeklyPlanSection();
};

/* ---------- init ---------- */

async function init() {
  applyLanguage();
  applyTheme();
  renderTranslations();

  const supported = FileStorage.isSupported();
  el.openFileBtn.hidden = !supported;
  if (!supported) showToast(tr().noFileApi, 'info');

  if (supported) {
    const remembered = await FileStorage.loadHandle();
    if (remembered) {
      try {
        // If permission isn't granted after a reload, leave the connect panel showing:
        // this page is a secondary, read-only view of the same file.
        if (await FileStorage.ensurePermission(remembered, false)) {
          await readAndRender(remembered);
        }
      } catch (err) {
        console.error(err);
      }
    }
  }

  // The weekly plan is a fully separate file/connection from the study data.
  await WeeklyPlanStore.init();
  renderWeeklyPlanSection();
}

init();
