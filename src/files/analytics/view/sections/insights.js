/* Rule-based insights list. */

import { buildInsights } from '../../data/index.js';
import { esc } from '../../charts/index.js';
import { el } from '../elements.js';
import { fillTemplate } from '../format.js';
import { INSIGHT_KEY } from '../i18n.js';
import { tr } from '../prefs.js';
import { store } from '../store.js';

export function renderInsights() {
  if (!el.insightsList) return;
  const t = tr();

  const insights = buildInsights({
    stats: store.stats,
    streaks: store.streaks,
    adherenceWeeks: store.adherenceWeeks,
    currentWeekComparison: store.currentWeekComparison,
  });

  if (!insights.length) {
    el.insightsList.innerHTML = '';
    if (el.insightsEmpty) el.insightsEmpty.hidden = false;
    return;
  }
  if (el.insightsEmpty) el.insightsEmpty.hidden = true;

  el.insightsList.innerHTML = insights
    .map((ins) => {
      const key = INSIGHT_KEY[ins.type];
      const template = key && t[key];
      return template ? `<li class="insight-item">${esc(fillTemplate(template, ins))}</li>` : '';
    })
    .join('');
}
