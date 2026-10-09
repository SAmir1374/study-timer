/* =============================================================
   ui/render — composes all render functions into `Render`.
   Public shape is unchanged: Render.all(), Render.timer(), …
   ============================================================= */

import { setText, resetTextCache } from './textCache.js';
import { clock, statusText, timer } from './timer.js';
import { stats } from './stats.js';
import { todaySubjects, timeline, history } from './lists.js';
import { presets, subjects, kind } from './pickers.js';
import { exam } from './exam.js';
import { saveStatus, weeklyPlanStatus } from './saveStatus.js';
import { weeklyPlan } from './weeklyPlan.js';
import { daysStrip } from './daysStrip.js';
import { getEffectiveDailyGoalMinutes } from '../planData.js';

export const Render = {
  setText,
  resetCache: resetTextCache,
  getEffectiveDailyGoalMinutes,

  clock,
  statusText,
  timer,
  stats,
  todaySubjects,
  timeline,
  history,
  presets,
  subjects,
  kind,
  weeklyPlan,
  exam,
  saveStatus,
  weeklyPlanStatus,
  daysStrip,

  all() {
    clock();
    timer();
    stats();
    todaySubjects();
    timeline();
    history();
    presets();
    kind();
    subjects();
    exam();
    saveStatus();
    daysStrip();
    weeklyPlan();
    weeklyPlanStatus();
  },
};
