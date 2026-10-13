/* =============================================================
   analytics/view/store.js — the page's mutable state in one place.

   handle / doc: the loaded study-data file (null when nothing is loaded
   or when the data came from "Import JSON" and has no file handle).

   last*: the most recent computed pieces, kept so weekly-plan and
   insights can re-render when either file loads independently.
   ============================================================= */

export const store = {
  handle: null,
  doc: null,

  stats: null,
  streaks: null,
  subjectStats: [],
  adherenceWeeks: [],
  currentWeekComparison: [],
};
