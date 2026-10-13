/* =============================================================
   Weekly-plan panel. Works with whichever of {plan file, study file}
   is loaded — either, both, or neither.
   ============================================================= */

import { fmtHoursMinutes } from '../../../timer.js';
import { WeeklyPlanStore } from '../../../weeklyPlanStore.js';
import {
  buildCurrentWeekPlanComparison,
  buildWeeklyPlanAdherence,
} from '../../data/index.js';
import { esc, renderCategoryBarChart } from '../../charts/index.js';
import { el } from '../elements.js';
import { dayLabel } from '../format.js';
import { tr } from '../prefs.js';
import { store } from '../store.js';
import { renderInsights } from './insights.js';

/* ---------- status ---------- */

function statusText() {
  const t = tr();
  const { state, name } = WeeklyPlanStore.status;

  switch (state) {
    case 'saved':
    case 'saving':
    case 'unsaved':
      return `${t.weeklyPlanStatusConnected}${name ? ` · ${name}` : ''}`;
    case 'permission':
      return t.weeklyPlanStatusPermission;
    case 'unsupported':
      return t.weeklyPlanStatusUnsupported;
    default:
      return t.weeklyPlanStatusDisconnected;
  }
}

export function renderWeeklyPlanStatus() {
  if (el.weeklyPlanStatusLabel) el.weeklyPlanStatusLabel.textContent = statusText();
}

/* ---------- parts ---------- */

function renderAdherenceChart(adherenceWeeks) {
  if (!el.weeklyPlanAdherenceChart) return;

  if (!adherenceWeeks.length) {
    el.weeklyPlanAdherenceChart.innerHTML = `<div class="chart-empty">${esc(tr().noWeeklyPlanWeeks)}</div>`;
    return;
  }

  // The week object rides along on each category (`meta`) so the tooltip needs no index lookup.
  const categories = adherenceWeeks.map((w) => ({
    label: dayLabel(w.weekStart),
    value: Math.max(0, Math.min(100, w.adherencePct)),
    meta: w,
  }));

  el.weeklyPlanAdherenceChart.innerHTML =
    renderCategoryBarChart(categories, {
      gap: 12,
      formatValue: (v) => `${Math.round(v)}%`,
      formatTooltip: (c) => {
        const w = c.meta;
        return `${c.label}: ${w.adherencePct}% (${fmtHoursMinutes(w.actualMinutes * 60)} / ${fmtHoursMinutes(w.plannedMinutes * 60)})`;
      },
    }) || '<div class="chart-empty">—</div>';
}

function renderCurrentWeekComparison(items) {
  if (!el.weeklyPlanCurrentWeekList) return;
  const t = tr();

  if (!items.length) {
    el.weeklyPlanCurrentWeekList.innerHTML = `<div class="empty-state analytics-empty">${esc(t.noCurrentWeekPlan)}</div>`;
    return;
  }

  const maxMinutes = Math.max(1, ...items.map((i) => Math.max(i.plannedMinutes, i.actualMinutes)));

  el.weeklyPlanCurrentWeekList.innerHTML = items
    .map((item) => {
      const barPct = Math.min(100, Math.round((item.actualMinutes / maxMinutes) * 100));
      return `
        <div class="subject-row">
          <div class="stat-item">
            <span class="stat-item__label">${esc(item.subject)}</span>
            <strong class="stat-item__value">${fmtHoursMinutes(item.actualMinutes * 60)} / ${fmtHoursMinutes(item.plannedMinutes * 60)}</strong>
          </div>
          <div class="progress-bar">
            <div class="progress-bar__fill" style="width: ${barPct}%"></div>
          </div>
          <span class="stat-card__meta">${item.pct}% ${esc(t.actualLabel)} / ${esc(t.plannedLabel)}</span>
        </div>`;
    })
    .join('');
}

function renderPlanAdherenceStat(adherenceWeeks) {
  if (!el.statPlanAdherence) return;
  const t = tr();

  if (!adherenceWeeks.length) {
    el.statPlanAdherence.textContent = '—';
    el.statPlanAdherenceMeta.textContent = t.noWeeklyPlanWeeks;
    return;
  }

  const avg = Math.round(
    adherenceWeeks.reduce((sum, w) => sum + Math.min(100, w.adherencePct), 0) / adherenceWeeks.length
  );
  el.statPlanAdherence.textContent = `${avg}%`;
  el.statPlanAdherenceMeta.textContent = `${adherenceWeeks.length} ${t.weeksTracked}`;
}

/* ---------- section ---------- */

/** Shows the empty note (with `message`) and clears derived plan data. */
function showEmpty(message) {
  el.weeklyPlanContent.hidden = true;
  if (el.weeklyPlanEmptyState) {
    el.weeklyPlanEmptyState.hidden = false;
    el.weeklyPlanEmptyState.textContent = message;
  }
  store.adherenceWeeks = [];
  store.currentWeekComparison = [];
  renderPlanAdherenceStat([]);
  renderInsights();
}

export function renderWeeklyPlanSection() {
  if (!el.weeklyPlanContent) return;
  const t = tr();

  renderWeeklyPlanStatus();

  if (!WeeklyPlanStore.hasData()) return showEmpty(t.weeklyPlanNotConnected);
  if (!store.doc) return showEmpty(t.weeklyPlanNeedStudyData);

  if (el.weeklyPlanEmptyState) el.weeklyPlanEmptyState.hidden = true;
  el.weeklyPlanContent.hidden = false;

  const sessions = store.doc.sessions || [];
  const plans = WeeklyPlanStore.getWeeks();

  store.adherenceWeeks = buildWeeklyPlanAdherence(plans, sessions);
  store.currentWeekComparison = buildCurrentWeekPlanComparison(plans, sessions);

  renderAdherenceChart(store.adherenceWeeks);
  renderCurrentWeekComparison(store.currentWeekComparison);
  renderPlanAdherenceStat(store.adherenceWeeks);
  renderInsights();
}
