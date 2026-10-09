/* =============================================================
   Days strip — success heatmap.
   7 rows (Sat..Fri) × N columns (weeks). One cell per plan day.
   Color = adherence (actual / planned): deep red → deep green.
   ============================================================= */

import { state, tr, todayKey } from '../../state.js';
import { el } from '../elements.js';
import {
  getActualMinutesForDate,
  getPlanDatesFromWeeklyPlan,
  getPlannedMinutesByDate,
} from '../planData.js';
import { DAY_MS, escapeHtml, formatPersianDate, toDateKey, utcMs } from '../utils.js';
import { openDayModal } from '../dayModal/index.js';

const DAY_LABELS = ['ش', 'ی', 'د', 'س', 'چ', 'پ', 'ج']; // Sat..Fri
const MAX_DAYS = 1500;

/** HSL color for an adherence ratio, or null when there is nothing to show. */
function ratioToHsl(actual, planned) {
  if (planned <= 0) return actual > 0 ? 'hsl(140, 68%, 40%)' : null; // bonus study

  // 0 → red (hue 0), 1 → green (hue 120), ≥1.25 → deep teal-green
  const ratio = Math.max(0, Math.min(1.25, actual / planned));
  const hue = ratio * 120;
  const sat = 62 + Math.min(18, ratio * 14);
  const light = 42 + (ratio > 1 ? (ratio - 1) * 8 : 0);

  return `hsl(${hue}, ${sat}%, ${light}%)`;
}

/** Plan range: Settings first, then the weekly plan. */
function resolvePlanRange() {
  let startKey = state.doc.studyPlan?.startDate;
  let endKey = state.doc.studyPlan?.examDate;

  if (!startKey || !endKey) {
    const detected = getPlanDatesFromWeeklyPlan();
    if (detected) {
      startKey = detected.startDate;
      endKey = detected.examDate;
    }
  }

  return startKey && endKey ? { startKey, endKey } : null;
}

function buildCell(key, today, plannedByDate) {
  const planned = plannedByDate.get(key) || 0;
  const actual = getActualMinutesForDate(key);
  const cellState = key < today ? 'past' : key === today ? 'today' : 'future';

  return {
    key,
    cellState,
    planned,
    actual,
    color: cellState === 'past' ? ratioToHsl(actual, planned) : null,
  };
}

function cellHtml(cell) {
  if (!cell) return '<div class="days-grid__cell days-grid__cell--empty"></div>';

  const classes = ['days-grid__cell'];
  if (cell.cellState === 'future') classes.push('days-grid__cell--future');
  if (cell.cellState === 'today') classes.push('days-grid__cell--today');

  const style = cell.color ? ` style="background:${cell.color}"` : '';
  const pct = cell.planned > 0 ? Math.round((cell.actual / cell.planned) * 100) : cell.actual > 0 ? 100 : 0;

  const tooltip =
    `${formatPersianDate(cell.key)}\n` +
    `برنامه: ${Math.round(cell.planned)}د\n` +
    `انجام: ${Math.round(cell.actual)}د\n` +
    `موفقیت: ${pct}%`;

  return `<div class="${classes.join(' ')}" data-date="${cell.key}" title="${escapeHtml(tooltip)}"${style}></div>`;
}

export function daysStrip() {
  const container = el.daysStrip;
  if (!container) return;

  const range = resolvePlanRange();
  if (!range) {
    container.innerHTML = `<div class="empty-state" style="padding:20px 0;font-size:12px">${escapeHtml(
      tr().setExamDates || 'Set your study start date and exam date in Settings.'
    )}</div>`;
    return;
  }

  const startMs = utcMs(range.startKey);
  const totalDays = Math.round((utcMs(range.endKey) - startMs) / DAY_MS) + 1;

  if (totalDays <= 0 || totalDays > MAX_DAYS) {
    container.innerHTML = '<div class="empty-state">—</div>';
    return;
  }

  const today = todayKey();
  const plannedByDate = getPlannedMinutesByDate();

  // Saturday = column 0
  const firstCol = (new Date(startMs).getUTCDay() + 1) % 7;
  const totalWeeks = Math.ceil((firstCol + totalDays) / 7);

  const grid = Array.from({ length: 7 }, () => Array(totalWeeks).fill(null));
  for (let i = 0; i < totalDays; i++) {
    const date = new Date(startMs + i * DAY_MS);
    const row = (date.getUTCDay() + 1) % 7;
    const col = Math.floor((firstCol + i) / 7);
    grid[row][col] = buildCell(toDateKey(date), today, plannedByDate);
  }

  const labelsHtml = DAY_LABELS.map((l) => `<span class="days-grid__label">${l}</span>`).join('');
  const cellsHtml = grid.map((row) => row.map(cellHtml).join('')).join('');

  container.innerHTML = `
    <div class="days-grid">
      <div class="days-grid__labels">${labelsHtml}</div>
      <div class="days-grid__cells" style="--week-count:${totalWeeks}">${cellsHtml}</div>
    </div>
  `;

  container.querySelectorAll('.days-grid__cell[data-date]').forEach((cell) => {
    cell.addEventListener('click', () => openDayModal(cell.dataset.date));
  });
}
