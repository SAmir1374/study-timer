/* =============================================================
   planOverviewUi.js — Professional Dashboard
   ============================================================= */

const $ = (id) => document.getElementById(id);

export const el = {
  connectPanel: $("connectPanel"),
  dashboard: $("dashboard"),
  connectWeeklyPlanBtn: $("connectWeeklyPlanBtn"),
  openWeeklyPlanBtn: $("openWeeklyPlanBtn"),
  themeToggle: $("themeToggle"),

  planHero: $("planHero"),
  kpiGrid: $("kpiGrid"),

  phaseTimeline: $("phaseTimeline"),
  phaseTimelineHint: $("phaseTimelineHint"),

  loadChart: $("loadChart"),
  loadChartHint: $("loadChartHint"),

  activityHeatmap: $("activityHeatmap"),
  heatmapLegend: $("heatmapLegend"),

  subjectDistribution: $("subjectDistribution"),
  sessionTypeMix: $("sessionTypeMix"),

  phaseList: $("phaseList"),

  monthList: $("monthList"),

  finalDaysSection: $("finalDaysSection"),
  finalDaysList: $("finalDaysList"),

  toast: $("toast"),
  toastText: $("toastText"),
};

/* ---------- Formatting ---------- */

function fmtHm(minutes) {
  const t = Math.round(Number(minutes) || 0);
  const h = Math.floor(t / 60);
  const m = t % 60;
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${String(m).padStart(2, "0")}m`;
}

function fmtHours(minutes) {
  const h = Number(minutes || 0) / 60;
  const r = Math.round(h * 10) / 10;
  return (Number.isInteger(r) ? String(r) : r.toFixed(1)) + "h";
}

function fmtFaDate(dateKey) {
  if (!dateKey) return "—";
  const [y, m, d] = dateKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, d));
  return date.toLocaleDateString("fa-IR-u-ca-persian", { month: "short", day: "numeric" });
}

function fmtFaMonth(monthKey) {
  if (!monthKey) return "—";
  const [y, m] = monthKey.split("-").map(Number);
  const date = new Date(Date.UTC(y, m - 1, 1));
  return date.toLocaleDateString("fa-IR-u-ca-persian", { month: "long", year: "numeric" });
}

/* ---------- Subject colors ---------- */

const SUBJECT_PALETTE = [
  "#8b7cff",
  "#38bdf8",
  "#5fd69b",
  "#f0b75e",
  "#f06d7a",
  "#a855f7",
  "#06b6d4",
  "#fb923c",
  "#4ade80",
  "#f472b6",
  "#60a5fa",
  "#facc15",
];

function hashStr(s) {
  let h = 0;
  for (let i = 0; i < s.length; i++) h = (h << 5) - h + s.charCodeAt(i);
  return Math.abs(h | 0);
}

export function colorForSubject(name) {
  return SUBJECT_PALETTE[hashStr(name) % SUBJECT_PALETTE.length];
}

/* ---------- Toast ---------- */

let toastTimer = null;
export function showToast(text, tone = "info") {
  if (!el.toast) return;
  el.toastText.textContent = text;
  el.toast.dataset.tone = tone;
  el.toast.hidden = false;
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => {
    el.toast.hidden = true;
  }, 4000);
}

/* =============================================================
   1. HERO — Exam countdown ring
   ============================================================= */

function renderHero(analytics) {
  if (!el.planHero) return;

  const goal = analytics.examGoal || {};
  const g = analytics.global;

  // Days until exam (from examGoal.targetWindow or notes — optional)
  // We compute from the plan's own range for now.
  const allDates = analytics.weeks.flatMap((w) => w.days.map((d) => d.date));
  const startDate = allDates.length ? allDates[0] : null;
  const lastDate = allDates.length ? allDates[allDates.length - 1] : null;

  const today = new Date().toISOString().slice(0, 10);
  const msPerDay = 86400000;
  const parseKey = (k) => new Date(`${k}T00:00:00Z`).getTime();

  let daysTotal = 0,
    daysPassed = 0,
    daysLeft = 0,
    progressPct = 0;
  if (startDate && lastDate) {
    daysTotal = Math.round((parseKey(lastDate) - parseKey(startDate)) / msPerDay) + 1;
    daysPassed = Math.max(
      0,
      Math.min(daysTotal, Math.round((parseKey(today) - parseKey(startDate)) / msPerDay) + 1),
    );
    daysLeft = Math.max(0, daysTotal - daysPassed);
    progressPct = daysTotal > 0 ? Math.round((daysPassed / daysTotal) * 100) : 0;
  }

  // Progress ring
  const r = 52;
  const circ = 2 * Math.PI * r;
  const dashOffset = circ - (progressPct / 100) * circ;

  const chips = [
    `${g.totalPhases} فاز`,
    `${g.totalWeeks} هفته`,
    `${g.totalDays} روز`,
    `${fmtHours(g.totalTargetMinutes)} برنامه`,
    `${Math.round(g.averageDailyEnglishMinutes)}د زبان/روز`,
  ];

  el.planHero.innerHTML = `
    <div class="plan-hero__left">
      <div class="plan-hero__eyebrow">
        <span class="plan-hero__eyebrow-dot"></span>
        مسیر آمادگی ارشد
      </div>
      <h1 class="plan-hero__title">${goal.program || "کارشناسی ارشد هوش مصنوعی"}</h1>
      <p class="plan-hero__subtitle">
        ${goal.targetUniversity ? `🎯 ${goal.targetUniversity}` : ""}
        ${goal.targetWindow ? ` • ${goal.targetWindow}` : ""}
      </p>
      <div class="plan-hero__chips">
        ${chips.map((c) => `<span class="plan-hero__chip">${c}</span>`).join("")}
      </div>
      <div class="plan-hero__progress-line">
        <div class="plan-hero__progress-bar">
          <span style="width:${progressPct}%"></span>
        </div>
        <span class="plan-hero__progress-text">${progressPct}% از کل مسیر</span>
      </div>
    </div>

    <div class="plan-hero__ring">
      <svg viewBox="0 0 120 120" class="progress-ring-svg">
        <circle class="progress-ring-bg" cx="60" cy="60" r="${r}" fill="none" stroke-width="8"/>
        <circle class="progress-ring-fg" cx="60" cy="60" r="${r}" fill="none" stroke-width="8"
          stroke-dasharray="${circ}" stroke-dashoffset="${dashOffset}"
          transform="rotate(-90 60 60)" stroke-linecap="round"/>
      </svg>
      <div class="plan-hero__ring-inner">
        <strong>${daysLeft}</strong>
        <span>روز مانده</span>
      </div>
    </div>
  `;
}

/* =============================================================
   2. KPI GRID
   ============================================================= */

const KPI_ICONS = {
  clock: "⏱️",
  weeks: "📆",
  phases: "🧩",
  subjects: "📚",
  hours: "🎯",
  english: "🇬🇧",
  sessions: "🔢",
  days: "🗓️",
};

function kpiCard(label, value, meta, icon) {
  const card = document.createElement("div");
  card.className = "plan-kpi";
  card.innerHTML = `
    <div class="plan-kpi__icon">${icon}</div>
    <div class="plan-kpi__body">
      <span class="plan-kpi__label">${label}</span>
      <strong class="plan-kpi__value">${value}</strong>
      ${meta ? `<span class="plan-kpi__meta">${meta}</span>` : ""}
    </div>
  `;
  return card;
}

function renderKpis(analytics) {
  if (!el.kpiGrid) return;
  const g = analytics.global;

  el.kpiGrid.innerHTML = "";

  const cards = [
    ["کل زمان برنامه", fmtHm(g.totalTargetMinutes), `${g.totalWeeks} هفته`, KPI_ICONS.clock],
    ["میانگین هفتگی", fmtHm(Math.round(g.averageWeeklyMinutes)), "در هفته", KPI_ICONS.hours],
    ["تعداد فازها", String(g.totalPhases), "مرحله‌ی آموزشی", KPI_ICONS.phases],
    ["تعداد هفته‌ها", String(g.totalWeeks), "هفته‌ی برنامه", KPI_ICONS.weeks],
    ["کل روزهای برنامه", String(g.totalDays), "روز", KPI_ICONS.days],
    ["تعداد جلسات", String(g.totalSessions || 0), "جلسه‌ی مطالعه", KPI_ICONS.sessions],
    [
      "زبان تخصصی",
      fmtHm(g.totalEnglishMinutes),
      `${Math.round(g.averageDailyEnglishMinutes)}د/روز`,
      KPI_ICONS.english,
    ],
    ["دروس اولویت‌دار", String(analytics.subjects.length), "درس", KPI_ICONS.subjects],
  ];

  cards.forEach(([label, value, meta, icon]) => {
    el.kpiGrid.appendChild(kpiCard(label, value, meta, icon));
  });
}

/* =============================================================
   3. PHASE TIMELINE
   ============================================================= */

const PHASE_COLORS = ["#8b7cff", "#38bdf8", "#5fd69b", "#f0b75e", "#f06d7a"];

function renderPhaseTimeline(analytics) {
  if (!el.phaseTimeline) return;
  const phases = analytics.phases;
  if (!phases.length) return;

  const parseKey = (k) => new Date(`${k}T00:00:00Z`).getTime();
  const firstStart = parseKey(phases[0].startDate);
  const lastEnd = parseKey(phases[phases.length - 1].endDate);
  const totalSpan = lastEnd - firstStart || 1;

  const today = new Date().toISOString().slice(0, 10);
  const todayMs = parseKey(today);
  const todayPct = ((todayMs - firstStart) / totalSpan) * 100;

  el.phaseTimeline.innerHTML = `
    <div class="plan-timeline__track">
      ${phases
        .map((p, i) => {
          const startPct = ((parseKey(p.startDate) - firstStart) / totalSpan) * 100;
          const widthPct = ((parseKey(p.endDate) - parseKey(p.startDate)) / totalSpan) * 100;
          const color = PHASE_COLORS[i % PHASE_COLORS.length];
          return `
          <div class="plan-timeline__segment" 
               style="left:${startPct}%;width:${Math.max(0.5, widthPct)}%;background:${color}"
               title="${p.name} — ${fmtHm(p.targetMinutes)}">
            <span class="plan-timeline__segment-label">${p.displayIndex}</span>
          </div>
        `;
        })
        .join("")}
      ${todayPct >= 0 && todayPct <= 100 ? `<div class="plan-timeline__today" style="left:${todayPct}%"></div>` : ""}
    </div>
    <div class="plan-timeline__legend">
      ${phases
        .map(
          (p, i) => `
        <div class="plan-timeline__legend-item">
          <span class="plan-timeline__legend-swatch" style="background:${PHASE_COLORS[i % PHASE_COLORS.length]}"></span>
          <span class="plan-timeline__legend-label">${p.name.replace(/^فاز\s*\d+\s*—\s*/, "")}</span>
          <span class="plan-timeline__legend-meta">${fmtFaDate(p.startDate)} – ${fmtFaDate(p.endDate)}</span>
        </div>
      `,
        )
        .join("")}
    </div>
  `;

  if (el.phaseTimelineHint) {
    el.phaseTimelineHint.textContent = `${phases.length} فاز • ${Math.round(totalSpan / 86400000)} روز`;
  }
}

/* =============================================================
   4. WEEKLY LOAD CHART
   ============================================================= */

function renderLoadChart(analytics) {
  if (!el.loadChart) return;
  const weeks = analytics.weeks;
  if (!weeks.length) return;

  const maxMin = Math.max(...weeks.map((w) => w.targetMinutes || 0), 1);

  const today = new Date().toISOString().slice(0, 10);
  const bars = weeks
    .map((w) => {
      const h = (w.targetMinutes / maxMin) * 100;
      let state = "future";
      if (w.endDate < today) state = "past";
      else if (w.startDate <= today && today <= w.endDate) state = "current";

      return `
      <div class="load-bar load-bar--${state}" title="هفته ${w.weekNumber} • ${w.title} — ${fmtHm(w.targetMinutes)}">
        <div class="load-bar__fill" style="height:${Math.max(4, h)}%"></div>
        <span class="load-bar__label">${w.weekNumber}</span>
      </div>
    `;
    })
    .join("");

  el.loadChart.innerHTML = `<div class="load-chart__bars">${bars}</div>`;

  if (el.loadChartHint) {
    el.loadChartHint.textContent = `میانگین: ${fmtHm(Math.round(analytics.global.averageWeeklyMinutes))} • بیشترین: ${fmtHm(maxMin)}`;
  }
}

/* =============================================================
   5. ACTIVITY HEATMAP
   ============================================================= */

function renderHeatmap(analytics) {
  if (!el.activityHeatmap) return;

  const weeks = analytics.weeks;
  if (!weeks.length) return;

  // Find max daily minutes to scale intensity
  const allDays = weeks.flatMap((w) => w.days);
  const maxDay = Math.max(...allDays.map((d) => d.totalMinutes || 0), 1);

  // Group by phase for coloring
  const phaseOfWeek = new Map();
  analytics.phases.forEach((p) => {
    p.weeks.forEach((w) => phaseOfWeek.set(w.id, p.displayIndex));
  });

  el.activityHeatmap.innerHTML = `
    <div class="heatmap-grid">
      ${weeks
        .map((w) => {
          const phaseIdx = phaseOfWeek.get(w.id) || 1;
          return `
          <div class="heatmap-week" data-phase="${phaseIdx}" title="هفته ${w.weekNumber}">
            ${w.days
              .map((d) => {
                const intensity = d.totalMinutes / maxDay;
                const level = intensity === 0 ? 0 : Math.ceil(intensity * 5);
                return `<div class="heatmap-cell heatmap-cell--l${level}" 
                            title="${d.date} • ${fmtHm(d.totalMinutes)}"></div>`;
              })
              .join("")}
          </div>
        `;
        })
        .join("")}
    </div>
  `;

  if (el.heatmapLegend) {
    el.heatmapLegend.innerHTML = `
      <span class="heatmap-legend__label">کم</span>
      ${[0, 1, 2, 3, 4, 5].map((l) => `<span class="heatmap-legend__swatch heatmap-cell--l${l}"></span>`).join("")}
      <span class="heatmap-legend__label">زیاد</span>
    `;
  }
}

/* =============================================================
   6a. SUBJECT DISTRIBUTION
   ============================================================= */

function renderSubjectDistribution(analytics) {
  if (!el.subjectDistribution) return;
  el.subjectDistribution.innerHTML = "";

  const subjects = analytics.subjects;
  if (!subjects.length) {
    el.subjectDistribution.innerHTML = `<div class="empty-state">درسی ثبت نشده است.</div>`;
    return;
  }

  const maxWeeks = Math.max(...subjects.map((s) => s.weekCount), 1);
  const totalWeeks = analytics.global.totalWeeks || 1;

  subjects.forEach((s) => {
    const row = document.createElement("div");
    row.className = "subject-bar-row";

    const pct = Math.round((s.weekCount / totalWeeks) * 100);
    const color = colorForSubject(s.name);
    const widthPct = Math.max(4, (s.weekCount / maxWeeks) * 100);

    row.innerHTML = `
      <div class="subject-bar-row__head">
        <span class="subject-bar-row__name">${s.name}</span>
        <span class="subject-bar-row__value">${s.weekCount} هفته · ${s.phaseCount} فاز</span>
      </div>
      <div class="subject-bar-row__track">
        <div class="subject-bar-row__fill" style="width:${widthPct}%;background:${color}"></div>
      </div>
      <span class="subject-bar-row__pct">${pct}%</span>
    `;
    el.subjectDistribution.appendChild(row);
  });
}

/* =============================================================
   6b. SESSION TYPE DONUT
   ============================================================= */

const SESSION_LABELS = {
  study: "مطالعه",
  practice: "تمرین",
  test: "تست",
  analysis: "تحلیل",
  review: "مرور",
};

const SESSION_COLORS = {
  study: "var(--kc-study)",
  practice: "var(--kc-practice)",
  test: "var(--kc-test)",
  analysis: "var(--kc-analysis)",
  review: "var(--kc-review)",
};

function renderSessionTypeMix(analytics) {
  if (!el.sessionTypeMix) return;

  const totals = analytics.sessionTypeTotals || {};
  const entries = Object.entries(totals).filter(([, v]) => v > 0);

  if (!entries.length) {
    el.sessionTypeMix.innerHTML = `<div class="empty-state">داده‌ای موجود نیست.</div>`;
    return;
  }

  const grandTotal = entries.reduce((s, [, v]) => s + v, 0);

  // Build donut segments
  const r = 15.9155;
  const circ = 2 * Math.PI * r;
  let offset = 0;
  const segments = entries
    .map(([type, val]) => {
      const pct = (val / grandTotal) * 100;
      const seg = `<circle class="donut-seg donut-seg--${type}" cx="21" cy="21" r="${r}"
      fill="none" stroke-width="6"
      stroke-dasharray="${pct} ${100 - pct}"
      stroke-dashoffset="${25 - offset}"></circle>`;
      offset += pct;
      return seg;
    })
    .join("");

  const legend = entries
    .map(([type, val]) => {
      const pct = Math.round((val / grandTotal) * 100);
      return `
      <div class="session-legend-row">
        <span class="session-legend-row__dot" style="background:${SESSION_COLORS[type]}"></span>
        <span class="session-legend-row__name">${SESSION_LABELS[type]}</span>
        <span class="session-legend-row__value">${fmtHm(val)}</span>
        <span class="session-legend-row__pct">${pct}%</span>
      </div>
    `;
    })
    .join("");

  el.sessionTypeMix.innerHTML = `
    <div class="session-donut">
      <svg viewBox="0 0 42 42" class="session-donut__svg">
        <circle class="session-donut__track" cx="21" cy="21" r="${r}" fill="none" stroke-width="6"/>
        ${segments}
        <text x="21" y="20" text-anchor="middle" class="session-donut__total">${fmtHm(grandTotal)}</text>
        <text x="21" y="24.5" text-anchor="middle" class="session-donut__sub">مجموع</text>
      </svg>
      <div class="session-donut__legend">${legend}</div>
    </div>
  `;
}

/* =============================================================
   7. PHASE CARDS
   ============================================================= */

function createPhaseCard(phase, color) {
  const card = document.createElement("article");
  card.className = "phase-card";
  card.style.setProperty("--phase-color", color);

  const dateRange = `${fmtFaDate(phase.startDate)} ← ${fmtFaDate(phase.endDate)}`;

  card.innerHTML = `
    <div class="phase-card__rail"></div>
    <div class="phase-card__body">
      <header class="phase-card__head">
        <div class="phase-card__identity">
          <span class="phase-card__index">فاز ${String(phase.displayIndex).padStart(2, "0")}</span>
          <h3 class="phase-card__title">${phase.name.replace(/^فاز\s*\d+\s*—\s*/, "")}</h3>
          <span class="phase-card__range">${dateRange}</span>
        </div>
        <div class="phase-card__target">
          <strong>${fmtHm(phase.targetMinutes)}</strong>
          <span>هدف فاز</span>
        </div>
      </header>

      ${phase.goal ? `<p class="phase-card__goal">🎯 ${phase.goal}</p>` : ""}

      <div class="phase-card__stats">
        <div class="phase-stat"><strong>${phase.weekCount}</strong><span>هفته</span></div>
        <div class="phase-stat"><strong>${phase.dayCount}</strong><span>روز</span></div>
        <div class="phase-stat"><strong>${fmtHm(phase.englishMinutes)}</strong><span>زبان</span></div>
        <div class="phase-stat"><strong>${phase.subjectCount}</strong><span>درس</span></div>
      </div>

      <div class="phase-card__weeks">
        ${phase.weeks
          .map(
            (w) => `
          <div class="week-pill" title="${w.title} — ${fmtHm(w.targetMinutes)}">
            <span class="week-pill__num">W${w.weekNumber || w.displayIndex}</span>
            <span class="week-pill__title">${w.title}</span>
          </div>
        `,
          )
          .join("")}
      </div>
    </div>
  `;
  return card;
}

function renderPhases(analytics) {
  if (!el.phaseList) return;
  el.phaseList.innerHTML = "";
  analytics.phases.forEach((p, i) => {
    el.phaseList.appendChild(createPhaseCard(p, PHASE_COLORS[i % PHASE_COLORS.length]));
  });
}

/* =============================================================
   8. MONTHLY OVERVIEW
   ============================================================= */

function renderMonths(analytics) {
  if (!el.monthList) return;
  el.monthList.innerHTML = "";

  const months = analytics.months;
  if (!months.length) {
    el.monthList.innerHTML = `<div class="empty-state">داده‌ای موجود نیست.</div>`;
    return;
  }

  const maxMin = Math.max(...months.map((m) => m.targetMinutes || 0), 1);

  months.forEach((m) => {
    const card = document.createElement("article");
    card.className = "month-card";

    const barPct = (m.targetMinutes / maxMin) * 100;

    card.innerHTML = `
      <div class="month-card__head">
        <h4 class="month-card__title">${fmtFaMonth(m.monthKey)}</h4>
        <span class="month-card__days">${m.dayCount} روز</span>
      </div>
      <div class="month-card__value">${fmtHm(m.targetMinutes)}</div>
      <div class="month-card__bar">
        <span style="width:${barPct}%"></span>
      </div>
      <div class="month-card__meta">
        <span>${m.weekCount} هفته</span>
        <span>${fmtHm(m.englishMinutes)} زبان</span>
      </div>
    `;
    el.monthList.appendChild(card);
  });
}

/* =============================================================
   9. FINAL DAYS
   ============================================================= */

function renderFinalDays(analytics) {
  if (!el.finalDaysSection || !el.finalDaysList) return;

  const days = analytics.finalDays;
  if (!days.length) {
    el.finalDaysSection.hidden = true;
    return;
  }

  el.finalDaysSection.hidden = false;
  el.finalDaysList.innerHTML = "";

  days.forEach((d) => {
    const card = document.createElement("article");
    card.className = "final-day-card";
    card.innerHTML = `
      <div class="final-day-card__date">${fmtFaDate(d.date)}</div>
      <p class="final-day-card__focus">${d.focus || "—"}</p>
      <div class="final-day-card__meta">
        <span>${fmtHm(d.totalMinutes)}</span>
        <span>${d.englishMinutes}د زبان</span>
      </div>
    `;
    el.finalDaysList.appendChild(card);
  });
}

/* =============================================================
   PUBLIC API
   ============================================================= */

export function renderDashboard(analytics) {
  if (!analytics) {
    if (el.connectPanel) el.connectPanel.hidden = false;
    if (el.dashboard) el.dashboard.hidden = true;
    return;
  }

  if (el.connectPanel) el.connectPanel.hidden = true;
  if (el.dashboard) el.dashboard.hidden = false;

  renderHero(analytics);
  renderKpis(analytics);
  renderPhaseTimeline(analytics);
  renderLoadChart(analytics);
  renderHeatmap(analytics);
  renderSubjectDistribution(analytics);
  renderSessionTypeMix(analytics);
  renderPhases(analytics);
  renderMonths(analytics);
  renderFinalDays(analytics);
}

export function applyTheme(theme) {
  document.body.setAttribute("data-theme", theme);
}
