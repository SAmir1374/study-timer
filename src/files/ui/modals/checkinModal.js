/* =============================================================
   ui/modals/checkinModal.js — Daily check-in modal (صبح / شب)
   بدنه‌ی مودال از روی تعریف سؤال‌ها ساخته می‌شود.
   ============================================================= */

const $ = (id) => document.getElementById(id);
const bodyEl = () => $("checkinModalBody");

let ctx = null; // { dateKey, slot, catchUp, sections, base, answers, warned }
let bound = false;

/* ============================================================
   تعریف پرسشنامه
   همه‌ی جمله‌ها: ۱ = اصلاً … ۵ = خیلی زیاد
   reverse = نمره‌گذاری معکوس (۶ − پاسخ)
   جهت نمره‌ها: خلق/انرژی/تمرکز بالا = خوب ؛ استرس/اضطراب بالا = بد
   ============================================================ */

const CONSTRUCTS = {
  mood: {
    title: "خلق",
    items: [
      { id: "m1", text: "امروز حال و حوصله‌ی خوبی داشتم" },
      { id: "m2", text: "از کارها و لحظه‌های روزم لذت بردم یا برایم جذاب بودند" },
      { id: "m3", text: "احساس غمگینی یا دلسردی داشتم", reverse: true },
      { id: "m4", text: "زود عصبی یا بی‌حوصله می‌شدم", reverse: true },
    ],
  },
  stress: {
    title: "استرس",
    items: [
      { id: "s1", text: "احساس می‌کردم فشار و بار زیادی روی دوشم است" },
      { id: "s2", text: "حس می‌کردم از پسِ کارهایم برنمی‌آیم" },
      { id: "s3", text: "بدنم تنش داشت (گردن، شانه، فک یا معده)" },
      { id: "s4", text: "می‌توانستم راحت آرام بمانم", reverse: true },
    ],
  },
  energy: {
    title: "انرژی",
    items: [
      { id: "e1", text: "انرژی جسمی داشتم" },
      { id: "e2", text: "ذهنم سرحال بود" },
      { id: "e3", text: "احساس خستگی یا کرختی داشتم", reverse: true },
    ],
  },
  focus: {
    title: "تمرکز",
    items: [
      { id: "f1", text: "روی کارهایم خوب تمرکز می‌کردم" },
      { id: "f2", text: "ذهنم مدام پرت می‌شد", reverse: true },
    ],
  },
  anxiety: {
    title: "نگرانی و اضطراب",
    items: [
      { id: "a1", text: "نگرانی یا افکار تکراری آزارم می‌داد" },
      { id: "a2", text: "دلشوره یا بی‌قراری داشتم" },
      { id: "a3", text: "افکار منفی درباره‌ی خودم یا آینده داشتم" },
    ],
  },
};

/* ---------- نمره‌گذاری ---------- */

const round1 = (n) => Math.round(n * 10) / 10;
const to10 = (mean) => round1(1 + ((mean - 1) * 9) / 4); // میانگین ۱–۵ → ۱–۱۰

function single(id) {
  const v = ctx.answers[id];
  return v == null ? null : to10(v);
}

function construct(name) {
  const items = CONSTRUCTS[name].items;
  const vals = [];
  for (const it of items) {
    const v = ctx.answers[it.id];
    if (v == null) continue;
    vals.push(it.reverse ? 6 - v : v);
  }
  // حداقل دوسوم جمله‌ها باید جواب داده شده باشند
  if (vals.length < Math.max(2, Math.ceil(items.length * 0.66))) return null;
  return to10(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/* ============================================================
   HTML builders (فقط کلاس‌های موجود در برنامه)
   ============================================================ */

const divider = (t) => `<div class="settings-divider">${t}</div>`;
const hint = (t) => `<p class="settings-hint">${t}</p>`;
const showIfAttr = (id) => (id ? ` data-showif="${id}" hidden` : "");

const likertRow = (id, text, showIf = "") => `
  <div class="field"${showIfAttr(showIf)}>
    <span class="field__label">${text}</span>
    <div class="preset-grid" data-likert="${id}" style="grid-template-columns:repeat(5,1fr)">
      ${[1, 2, 3, 4, 5]
        .map((v) => `<button type="button" class="preset-btn" data-v="${v}" aria-pressed="false">${v}</button>`)
        .join("")}
    </div>
  </div>`;

const timeField = (id, label) => `
  <label class="field">
    <span class="field__label">${label}</span>
    <input type="time" id="ck_${id}" />
  </label>`;

const numField = (id, label, attrs = "", showIf = "") => `
  <label class="field"${showIfAttr(showIf)}>
    <span class="field__label">${label}</span>
    <input type="number" id="ck_${id}" ${attrs} />
  </label>`;

const toggle = (id, label) => `
  <label class="setting-toggle">
    <input type="checkbox" id="ck_${id}" />
    <span>${label}</span>
  </label>`;

const constructHtml = (name) =>
  divider(CONSTRUCTS[name].title) + CONSTRUCTS[name].items.map((it) => likertRow(it.id, it.text)).join("");

const SECTIONS = {
  sleep: () =>
    divider("خواب دیشب") +
    `<div class="settings-grid">` +
    timeField("bedTime", "ساعت خواب") +
    timeField("wakeTime", "ساعت بیداری") +
    numField("hours", "مدت خواب (ساعت — خودکار)", `min="0" max="24" step="0.1" inputmode="decimal"`) +
    numField("latency", "چند دقیقه طول کشید تا خوابت ببرد؟", `min="0" max="600" inputmode="numeric"`) +
    numField("awakenings", "چند بار شب بیدار شدی؟", `min="0" max="20" inputmode="numeric"`) +
    `</div>` +
    likertRow("s_quality", "کیفیت کلی خواب (۱ = خیلی بد، ۵ = عالی)") +
    likertRow("s_rested", "وقتی بیدار شدم احساس استراحت‌کردگی داشتم"),

  routine: () =>
    divider("روتین آرام‌سازی دیشب") +
    `<div class="settings-options">` +
    toggle("routineDone", "روتین را انجام دادی؟") +
    numField("routineSteps", "چند مرحله؟", `min="0" max="100" inputmode="numeric"`, "routineDone") +
    `</div>` +
    likertRow("r_eff", "روتین چقدر به آرام شدنت کمک کرد؟ (۱ = اصلاً، ۵ = خیلی)", "routineDone"),

  now: () =>
    divider("همین الان") +
    hint("۱ = اصلاً · ۵ = خیلی زیاد") +
    likertRow("n_mood", "الان حال و حوصله‌ام خوب است") +
    likertRow("n_energy", "الان انرژی دارم") +
    likertRow("n_tension", "الان تنش یا نگرانی دارم"),

  mood: () => constructHtml("mood"),
  stress: () => constructHtml("stress"),
  energy: () => constructHtml("energy"),
  focus: () => constructHtml("focus"),
  anxiety: () => constructHtml("anxiety"),

  activities: () =>
    divider("فعالیت‌ها") +
    `<div class="settings-options">` +
    toggle("activity1", "فعالیت شماره ۱") +
    toggle("operation1", "عملیات د۱") +
    toggle("exerciseDone", "امروز ورزش کردی؟") +
    numField("exerciseMin", "چند دقیقه؟", `min="0" max="600" inputmode="numeric"`, "exerciseDone") +
    `</div>`,

  mast: () =>
    divider("خودارضایی (امروز)") +
    `<div class="settings-options">` +
    toggle("mastPos", "مثبت — از روی میل و لذت") +
    numField("mastPosCount", "تعداد", `min="0" max="20" inputmode="numeric"`, "mastPos") +
    toggle("mastNeg", "منفی — از روی فشار روانی / اجبار") +
    numField("mastNegCount", "تعداد", `min="0" max="20" inputmode="numeric"`, "mastNeg") +
    `</div>`,

  food: () =>
    divider("تغذیه و مصرف‌ها") +
    `<div class="settings-grid">` +
    numField("meals", "تعداد وعده‌ها", `min="0" max="10" inputmode="numeric"`) +
    numField("caffeine", "قهوه / چای / انرژی‌زا (تعداد)", `min="0" max="20" inputmode="numeric"`) +
    `</div>` +
    likertRow("f_quality", "کیفیت تغذیه‌ی امروز (۱ = خیلی بد، ۵ = عالی)") +
    `<div class="settings-options">` +
    toggle("water", "آب کافی خوردی؟") +
    `</div>`,

  day: () =>
    divider("جمع‌بندی") +
    likertRow("d_day", "در مجموع امروز روز خوبی بود (۱ = اصلاً، ۵ = خیلی)"),

  notes: () =>
    divider("یادداشت (اختیاری)") +
    `<label class="field">
       <textarea id="ck_notes" rows="2" maxlength="500"
         placeholder="اتفاق مهم، احساس، یا چیز خاصی که می‌خوای یادت بمونه…"></textarea>
     </label>`,
};

/* ============================================================
   Sleep-hours helpers
   ============================================================ */

export function computeSleepHours(bedTime, wakeTime) {
  if (!bedTime || !wakeTime) return null;
  const [bh, bm] = bedTime.split(":").map(Number);
  const [wh, wm] = wakeTime.split(":").map(Number);
  if (![bh, bm, wh, wm].every(Number.isFinite)) return null;
  let bedMin = bh * 60 + bm;
  let wakeMin = wh * 60 + wm;
  if (wakeMin <= bedMin) wakeMin += 24 * 60;
  return round1((wakeMin - bedMin) / 60);
}

export function recalcSleepHours() {
  const hours = computeSleepHours($("ck_bedTime")?.value || "", $("ck_wakeTime")?.value || "");
  if (hours == null) return;
  const out = $("ck_hours");
  if (out) out.value = String(hours);
}

/* ============================================================
   UI state helpers
   ============================================================ */

function localKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

/* اگر اسلات صریحاً داده نشد: بازه‌ی ۰۴–۱۸ صبح (مگر صبح ثبت شده)، بقیه شب */
function inferSlot(entry, now = new Date()) {
  const h = now.getHours();
  if (h >= 18 || h < 4) return "evening";
  return entry?.slots?.morning ? "evening" : "morning";
}

function paint(id) {
  const grid = bodyEl()?.querySelector(`[data-likert="${id}"]`);
  if (!grid || !ctx) return;
  const cur = ctx.answers[id];
  grid.querySelectorAll(".preset-btn").forEach((b) => {
    const on = Number(b.dataset.v) === cur;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

function syncShowIf() {
  bodyEl()
    ?.querySelectorAll("[data-showif]")
    .forEach((w) => {
      w.hidden = !$("ck_" + w.dataset.showif)?.checked;
    });
}

/* وقتی یک تیک برداشته شد، فیلدهای وابسته‌اش خالی شوند */
function clearDependents(toggleId) {
  bodyEl()
    ?.querySelectorAll(`[data-showif="${toggleId}"]`)
    .forEach((w) => {
      w.querySelectorAll("input").forEach((i) => (i.value = ""));
      w.querySelectorAll("[data-likert]").forEach((g) => {
        delete ctx.answers[g.dataset.likert];
        paint(g.dataset.likert);
      });
    });
}

function showMsg(text) {
  const m = $("ck_msg");
  if (!m) return;
  m.textContent = text;
  m.hidden = false;
  m.scrollIntoView({ block: "nearest" });
}

function hideMsg() {
  const m = $("ck_msg");
  if (m) m.hidden = true;
}

function fill(e) {
  const set = (id, v) => {
    const n = $("ck_" + id);
    if (n) n.value = v == null ? "" : String(v);
  };
  const chk = (id, v) => {
    const n = $("ck_" + id);
    if (n) n.checked = !!v;
  };

  set("bedTime", e.sleep?.bedTime);
  set("wakeTime", e.sleep?.wakeTime);
  set("hours", e.sleep?.hours);
  set("latency", e.sleep?.latencyMin);
  set("awakenings", e.sleep?.awakenings);

  chk("routineDone", e.relaxationRoutine?.done);
  set("routineSteps", e.relaxationRoutine?.steps);

  chk("activity1", e.activity1 === true);
  chk("operation1", e.operation1 === true);
  chk("exerciseDone", e.exercise?.done);
  set("exerciseMin", e.exercise?.minutes);

  chk("mastPos", e.masturbation?.positive?.done);
  set("mastPosCount", e.masturbation?.positive?.count);
  chk("mastNeg", e.masturbation?.negative?.done);
  set("mastNegCount", e.masturbation?.negative?.count);

  set("meals", e.food?.meals);
  set("caffeine", e.food?.caffeine);
  chk("water", e.food?.water);

  set("notes", e.notes);
}

function bind() {
  if (bound) return;
  const root = bodyEl();
  if (!root) return;
  bound = true;

  root.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".preset-btn");
    if (!btn || !ctx) return;
    const grid = btn.closest("[data-likert]");
    if (!grid) return;
    const id = grid.dataset.likert;
    const v = Number(btn.dataset.v);
    if (ctx.answers[id] === v) delete ctx.answers[id]; // دوباره‌زدن = پاک‌کردن
    else ctx.answers[id] = v;
    paint(id);
    hideMsg();
  });

  root.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!ctx || t.type !== "checkbox") return;
    if (!t.checked) clearDependents(t.id.replace(/^ck_/, ""));
    syncShowIf();
  });

  root.addEventListener("input", (ev) => {
    if (ev.target.id === "ck_bedTime" || ev.target.id === "ck_wakeTime") recalcSleepHours();
  });
}

/* ============================================================
   open / close
   ============================================================ */

export function openCheckinModal(dateKey, existingEntry, slotOverride) {
  const root = bodyEl();
  const modal = $("checkinModal");
  if (!root || !modal || !existingEntry) {
    console.error("openCheckinModal: missing modal body or entry");
    return;
  }
  bind();

  const entry = JSON.parse(JSON.stringify(existingEntry));
  const slot = slotOverride || inferSlot(entry);
  const catchUp = slot === "evening" && !entry.slots?.morning;

  const sections =
    slot === "morning"
      ? ["sleep", "routine", "now"]
      : [
          ...(catchUp ? ["sleep", "routine"] : []),
          "mood", "stress", "energy", "focus", "anxiety",
          "activities", "mast", "food", "day", "notes",
        ];

  const answers = {};
  for (const [k, v] of Object.entries(entry.items || {})) if (v != null) answers[k] = v;

  ctx = { dateKey, slot, catchUp, sections, base: entry, answers, warned: false };

  const intro =
    slot === "morning"
      ? "حدود ۱ دقیقه — درباره‌ی خواب دیشب و حال همین الان."
      : "حدود ۲ دقیقه — هر جمله را برای کل امروز (تا همین لحظه) نمره بده: ۱ = اصلاً · ۵ = خیلی زیاد." +
        (catchUp ? " چون چک‌این صبح ثبت نشده، بخش خواب و روتین هم اینجا آمده است." : "");

  root.innerHTML =
    hint(intro) + sections.map((s) => SECTIONS[s]()).join("") + `<p class="settings-hint" id="ck_msg" hidden></p>`;

  fill(entry);
  syncShowIf();
  root.querySelectorAll("[data-likert]").forEach((g) => paint(g.dataset.likert));
  root.scrollTop = 0;

  const title = $("checkinModalTitle");
  if (title) {
    const base = slot === "morning" ? "چک‌این صبح" : "چک‌این شب";
    title.textContent = dateKey === localKey() ? base : `${base} — ${dateKey}`;
  }

  modal.hidden = false;
  modal.setAttribute("aria-hidden", "false");
}

export function closeCheckinModal() {
  const modal = $("checkinModal");
  if (modal) {
    modal.hidden = true;
    modal.setAttribute("aria-hidden", "true");
  }
  ctx = null;
}

export function getCheckinDateKey() {
  return ctx ? ctx.dateKey : null;
}

/* ============================================================
   read → entry کامل (ورودی موجود + مقادیر این اسلات)
   null = ذخیره نشود (پیام داخل مودال نشان داده می‌شود)
   ============================================================ */

const clamp = (n, lo, hi) => (n == null ? null : Math.min(hi, Math.max(lo, n)));

export function readCheckinForm() {
  if (!ctx) return null;
  const { slot, sections, answers } = ctx;
  const has = (name) => sections.includes(name);

  // کامل‌بودن پاسخ‌ها: یک‌بار هشدار نرم، بار دوم ذخیره می‌شود
  const rows = [...bodyEl().querySelectorAll("[data-likert]")].filter((g) => !g.closest("[hidden]"));
  const missing = rows.filter((g) => answers[g.dataset.likert] == null).length;
  if (missing > 0 && !ctx.warned) {
    ctx.warned = true;
    showMsg(`${missing} سؤال بی‌پاسخ مانده. برای ذخیره‌ی همین‌طوری، دوباره «ذخیره» را بزن.`);
    return null;
  }

  const num = (id) => {
    const v = $("ck_" + id)?.value;
    if (v === "" || v == null) return null;
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  };
  const int = (id, lo, hi) => {
    const n = num(id);
    return n == null ? null : clamp(Math.round(n), lo, hi);
  };
  const str = (id) => {
    const s = ($("ck_" + id)?.value ?? "").trim();
    return s === "" ? null : s;
  };
  const checked = (id) => !!$("ck_" + id)?.checked;

  const e = JSON.parse(JSON.stringify(ctx.base));
  const now = new Date().toISOString();

  if (has("sleep")) {
    const bedTime = str("bedTime");
    const wakeTime = str("wakeTime");
    const hoursRaw = num("hours");
    const hours = hoursRaw == null ? computeSleepHours(bedTime || "", wakeTime || "") : clamp(hoursRaw, 0, 24);
    e.sleep = {
      ...e.sleep,
      bedTime,
      wakeTime,
      hours: hours == null ? null : round1(hours),
      latencyMin: int("latency", 0, 600),
      awakenings: int("awakenings", 0, 20),
      quality: single("s_quality"),
      restedness: single("s_rested"),
    };
  }

  if (has("routine")) {
    const done = checked("routineDone");
    e.relaxationRoutine = {
      done,
      steps: done ? int("routineSteps", 0, 100) : null,
      effectiveness: done ? single("r_eff") : null,
    };
  }

  if (has("now")) {
    e.morningState = {
      mood: single("n_mood"),
      energy: single("n_energy"),
      tension: single("n_tension"),
    };
  }

  if (slot === "evening") {
    e.mood = {
      rating: construct("mood"),
      stress: construct("stress"),
      energy: construct("energy"),
      focus: construct("focus"),
      anxiety: construct("anxiety"),
    };

    e.activity1 = checked("activity1");
    e.operation1 = checked("operation1");

    const exDone = checked("exerciseDone");
    e.exercise = { done: exDone, minutes: exDone ? int("exerciseMin", 0, 600) : null };

    const posDone = checked("mastPos");
    const negDone = checked("mastNeg");
    e.masturbation = {
      positive: { done: posDone, count: posDone ? int("mastPosCount", 0, 20) : null },
      negative: { done: negDone, count: negDone ? int("mastNegCount", 0, 20) : null },
    };

    e.food = {
      meals: int("meals", 0, 10),
      quality: single("f_quality"),
      water: checked("water"),
      caffeine: int("caffeine", 0, 20),
    };

    e.dayRating = single("d_day");
    e.notes = str("notes");
  }

  e.items = { ...e.items, ...answers };
  e.slots = { ...e.slots, [slot]: now };
  if (ctx.catchUp) e.slots.morning = now;

  return e;
}