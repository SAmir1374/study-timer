/* Subjects: leaderboard rows + share donut. */

import { fmtHoursMinutes } from '../../../timer.js';
import { categoricalPalette, esc, renderDonutChart } from '../../charts/index.js';
import { el } from '../elements.js';
import { tr } from '../prefs.js';

export function renderSubjectStats(items, totalStudySeconds) {
  if (!el.subjectStats) return;
  const t = tr();

  if (!items.length) {
    el.subjectStats.innerHTML = `<div class="empty-state analytics-empty">${esc(t.noSubjectsYet)}</div>`;
    return;
  }

  const maxSeconds = Math.max(1, ...items.map((i) => i.studySeconds));

  el.subjectStats.innerHTML = items
    .map((item) => {
      const time = item.studySeconds > 0 ? fmtHoursMinutes(item.studySeconds) : '—';
      const pct = totalStudySeconds > 0 ? Math.round((item.studySeconds / totalStudySeconds) * 100) : 0;
      const barPct = Math.round((item.studySeconds / maxSeconds) * 100);

      return `
        <div class="subject-row">
          <div class="stat-item">
            <span class="stat-item__label">${esc(item.subject)}</span>
            <strong class="stat-item__value">${time}</strong>
          </div>
          <div class="progress-bar">
            <div class="progress-bar__fill" style="width: ${barPct}%"></div>
          </div>
          <span class="stat-card__meta">${pct}% ${esc(t.ofTotalTime)} · ${item.sessionCount} ${esc(t.sessions)}</span>
        </div>`;
    })
    .join('');
}

export function renderSubjectDonut(subjectStats) {
  if (!el.subjectDonutChart) return;

  const withTime = subjectStats.filter((s) => s.studySeconds > 0);
  if (!withTime.length) {
    el.subjectDonutChart.innerHTML = '<div class="chart-empty">—</div>';
    el.subjectDonutLegend.innerHTML = '';
    return;
  }

  const colors = categoricalPalette(withTime.length);
  const total = withTime.reduce((sum, s) => sum + s.studySeconds, 0);
  const segments = withTime.map((s, i) => ({ value: s.studySeconds, label: s.subject, color: colors[i] }));

  el.subjectDonutChart.innerHTML = renderDonutChart(segments) || '<div class="chart-empty">—</div>';
  el.subjectDonutLegend.innerHTML = segments
    .map((seg) => {
      const pct = Math.round((seg.value / total) * 100);
      return `<span class="chart-legend__item"><span class="chart-legend__swatch" style="background:${seg.color}"></span>${esc(seg.label)} · ${pct}%</span>`;
    })
    .join('');
}
