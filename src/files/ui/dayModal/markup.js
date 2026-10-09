/* Static skeleton of the day-details modal. */

export const DAY_MODAL_HTML = `
  <div class="modal__backdrop" data-close-day-modal></div>
  <div class="modal__dialog day-dialog" role="dialog" aria-modal="true" aria-labelledby="dayModalTitle">
    <div class="modal__header">
      <div class="day-modal__heading">
        <h2 id="dayModalTitle"></h2>
        <p class="settings-hint" id="dayModalSubtitle"></p>
      </div>
      <button type="button" class="modal-close" id="dayModalCloseBtn" aria-label="Close" title="Close">×</button>
    </div>
    <div class="modal__body">
      <div class="day-tabs" id="dayModalTabs" role="tablist">
        <button type="button" class="day-tab" role="tab" id="dayTabActual" data-day-tab="actual" aria-controls="dayPanelActual"></button>
        <button type="button" class="day-tab" role="tab" id="dayTabPlan" data-day-tab="plan" aria-controls="dayPanelPlan"></button>
        <button type="button" class="day-tab" role="tab" id="dayTabAnalysis" data-day-tab="analysis" aria-controls="dayPanelAnalysis"></button>
      </div>

      <section class="day-panel" id="dayPanelActual" role="tabpanel" data-day-panel="actual" aria-labelledby="dayTabActual">
        <div class="day-modal__summary" id="dayModalSummary"></div>
        <div class="section-label" id="dayModalTimelineLabel"></div>
        <div class="empty-state" id="dayModalTimelineEmpty" hidden></div>
        <div class="day-timeline__scroll" id="dayModalScroll">
          <div class="day-timeline" id="dayModalTimeline"></div>
        </div>
        <div class="day-legend" id="dayModalLegend"></div>
      </section>

      <section class="day-panel" id="dayPanelPlan" role="tabpanel" data-day-panel="plan" aria-labelledby="dayTabPlan" hidden>
        <div class="day-modal__summary" id="dayPlanSummary"></div>
        <div class="section-label" id="dayPlanListLabel"></div>
        <div class="plan-agenda" id="dayPlanSessions"></div>
        <div class="weekly-plan-day__note" id="dayPlanNote" hidden></div>
        <div id="dayPlanMix"></div>
        <div class="section-label" id="dayPlanClockLabel"></div>
        <div class="empty-state" id="dayPlanClockEmpty" hidden></div>
        <div class="day-timeline__scroll" id="dayPlanScroll" hidden>
          <div class="day-timeline" id="dayPlanTimeline"></div>
        </div>
      </section>

      <section class="day-panel" id="dayPanelAnalysis" role="tabpanel" data-day-panel="analysis" aria-labelledby="dayTabAnalysis" hidden>
        <div id="dayAnalysisBody"></div>
      </section>
    </div>
  </div>
`;
