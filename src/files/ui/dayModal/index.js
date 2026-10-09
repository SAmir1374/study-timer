/* =============================================================
   Day details modal (Recorded / Plan / Analysis tabs).
   Plan: Phase → Week → Day.  Opened from the weekly plan cards
   and from the days heatmap.
   ============================================================= */

import { todayKey } from '../../state.js';
import { makeL, getLanguage } from '../utils.js';
import {
  getActualMinutesForModalDay,
  getDayStatus,
  getWeeklyPlanDayContext,
  computeDaySummary,
} from '../planData.js';
import { DAY_HOUR_PX, formatDateKeyForModal } from './shared.js';
import { DAY_MODAL_HTML } from './markup.js';
import { renderActualTab } from './actualTab.js';
import { renderPlanTab } from './planTab.js';
import { renderAnalysisTab } from './analysisTab.js';

const DAY_TABS = ['actual', 'plan', 'analysis'];

let root = null;
let refs = null;
let currentDate = null;
let currentTab = 'actual';

/* ---------- DOM ---------- */

function ensureModal() {
  if (root) return refs;

  root = document.createElement('div');
  root.className = 'modal';
  root.id = 'dayModal';
  root.hidden = true;
  root.setAttribute('aria-hidden', 'true');
  root.innerHTML = DAY_MODAL_HTML;
  document.body.appendChild(root);

  const q = (id) => root.querySelector(`#${id}`);
  refs = {
    title: q('dayModalTitle'),
    subtitle: q('dayModalSubtitle'),
    tabActual: q('dayTabActual'),
    tabPlan: q('dayTabPlan'),
    tabAnalysis: q('dayTabAnalysis'),

    summary: q('dayModalSummary'),
    timelineLabel: q('dayModalTimelineLabel'),
    timelineEmpty: q('dayModalTimelineEmpty'),
    scroll: q('dayModalScroll'),
    timeline: q('dayModalTimeline'),
    legend: q('dayModalLegend'),

    planSummary: q('dayPlanSummary'),
    planListLabel: q('dayPlanListLabel'),
    planSessions: q('dayPlanSessions'),
    planNote: q('dayPlanNote'),
    planMix: q('dayPlanMix'),
    planClockLabel: q('dayPlanClockLabel'),
    planClockEmpty: q('dayPlanClockEmpty'),
    planScroll: q('dayPlanScroll'),
    planTimeline: q('dayPlanTimeline'),

    analysisBody: q('dayAnalysisBody'),
  };

  root.addEventListener('click', (event) => {
    const tabBtn = event.target.closest('[data-day-tab]');
    if (tabBtn) {
      currentTab = tabBtn.dataset.dayTab;
      applyTab();
      return;
    }
    if (event.target.closest('[data-close-day-modal]') || event.target.closest('#dayModalCloseBtn')) {
      closeDayModal();
    }
  });

  // Arrow-key navigation between tabs (direction-aware).
  q('dayModalTabs').addEventListener('keydown', (event) => {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;

    const rtl = document.documentElement.dir === 'rtl';
    const step = (event.key === 'ArrowRight' ? 1 : -1) * (rtl ? -1 : 1);
    const next = (DAY_TABS.indexOf(currentTab) + step + DAY_TABS.length) % DAY_TABS.length;

    currentTab = DAY_TABS[next];
    applyTab();
    root.querySelector(`[data-day-tab="${currentTab}"]`).focus();
    event.preventDefault();
  });

  return refs;
}

function applyTab() {
  if (!root) return;

  DAY_TABS.forEach((name) => {
    const active = name === currentTab;
    const btn = root.querySelector(`[data-day-tab="${name}"]`);
    const panel = root.querySelector(`[data-day-panel="${name}"]`);

    btn.classList.toggle('is-active', active);
    btn.setAttribute('aria-selected', String(active));
    btn.tabIndex = active ? 0 : -1;
    panel.hidden = !active;
  });

  requestAnimationFrame(scrollTimeline);
}

function scrollTimeline() {
  if (!root || root.hidden || !refs) return;

  const scrollEl =
    currentTab === 'actual' ? refs.scroll : currentTab === 'plan' ? refs.planScroll : null;
  if (!scrollEl || scrollEl.hidden) return;

  const focusMin = Number(scrollEl.dataset.focus);
  const minutes = Number.isFinite(focusMin) ? focusMin : 6 * 60;
  scrollEl.scrollTop = Math.max(0, (minutes / 60) * DAY_HOUR_PX - DAY_HOUR_PX);
}

/* ---------- render ---------- */

function renderDayModal(dateKey) {
  const planContext = getWeeklyPlanDayContext(dateKey);
  if (!planContext) return;

  const modalRefs = ensureModal();
  const language = getLanguage();
  const L = makeL(language);
  const today = todayKey();
  const actualMinutes = getActualMinutesForModalDay(dateKey);

  const ctx = {
    dateKey,
    today,
    language,
    actualMinutes,
    day: planContext.day,
    week: planContext.week,
    status: getDayStatus(dateKey, actualMinutes, today),
  };

  const dateLabel = formatDateKeyForModal(dateKey, language, {
    weekday: 'long',
    month: 'long',
    day: 'numeric',
    year: 'numeric',
  });

  modalRefs.title.textContent =
    computeDaySummary(planContext.day).focus || planContext.week.title || dateLabel;
  modalRefs.subtitle.textContent = `${dateLabel} · ${dateKey}`;
  modalRefs.tabActual.textContent = L('انجام‌شده', 'Recorded');
  modalRefs.tabPlan.textContent = L('برنامه', 'Plan');
  modalRefs.tabAnalysis.textContent = L('تحلیل', 'Analysis');

  renderActualTab(modalRefs, ctx);
  renderPlanTab(modalRefs, ctx);
  renderAnalysisTab(modalRefs, ctx);
  applyTab();
}

/* ---------- public API ---------- */

export function openDayModal(dateKey) {
  if (!getWeeklyPlanDayContext(dateKey)) return;

  ensureModal();
  currentDate = dateKey;
  root.hidden = false;
  root.setAttribute('aria-hidden', 'false');
  renderDayModal(dateKey);
}

export function closeDayModal() {
  if (!root) return;
  currentDate = null;
  root.hidden = true;
  root.setAttribute('aria-hidden', 'true');
}

/** Re-render if open (e.g. after a language change). */
export function refreshDayModal() {
  if (currentDate) renderDayModal(currentDate);
}

export function isDayModalOpen() {
  return Boolean(root && !root.hidden);
}

document.addEventListener('keydown', (event) => {
  if (event.key === 'Escape' && isDayModalOpen()) closeDayModal();
});
