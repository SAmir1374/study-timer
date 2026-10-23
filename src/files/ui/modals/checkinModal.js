/* =============================================================
   ui/modals/checkinModal.js — Daily check-in modal (صبح / شب)
   بدنه‌ی مودال از روی تعریف سؤال‌ها ساخته می‌شود.
   ============================================================= */

import { MEALS, FOOD_GROUPS, foodLabel } from "../../daliycheck/foodCatalog.js";
import { DailyCheckinStore } from "../../daliycheck/dailyCheckinStore.js";
import { createCheckinEntry, prevDateKey } from "../../daliycheck/dailyCheckinData.js";

const $ = (id) => document.getElementById(id);
const bodyEl = () => $("checkinModalBody");

let ctx = null; // { dateKey, slot, catchUp, sections, base, answers, choices, foodSel, activeMeal, freq, warned }
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

const AMOUNTS = [
  ["0.5", "نصف"],
  ["1", "۱ عدد"],
  ["1.5", "۱ و نیم"],
  ["2", "۲ عدد"],
];

const DRIVERS = [
  ["choice", "انتخاب آگاهانه"],
  ["urge", "از روی فشار / اجبار"],
];

const YES_NO = [
  ["yes", "بله"],
  ["no", "نه"],
];

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

/* showIf = id یک چک‌باکس ؛ showChoice = "id:value" برای دکمه‌های انتخابی */
const showAttr = (showIf, showChoice) =>
  showIf ? ` data-showif="${showIf}" hidden` : showChoice ? ` data-showchoice="${showChoice}" hidden` : "";

const likertRow = (id, text, showIf = "") => `
  <div class="field"${showAttr(showIf)}>
    <span class="field__label">${text}</span>
    <div class="preset-grid" data-likert="${id}" style="grid-template-columns:repeat(5,1fr)">
      ${[1, 2, 3, 4, 5]
        .map((v) => `<button type="button" class="preset-btn" data-v="${v}" aria-pressed="false">${v}</button>`)
        .join("")}
    </div>
  </div>`;

const choiceRow = (id, text, options, showIf = "") => `
  <div class="field"${showAttr(showIf)}>
    <span class="field__label">${text}</span>
    <div class="preset-grid" data-choice="${id}" style="grid-template-columns:repeat(${options.length},1fr)">
      ${options
        .map(([v, l]) => `<button type="button" class="preset-btn" data-v="${v}" aria-pressed="false">${l}</button>`)
        .join("")}
    </div>
  </div>`;

const timeField = (id, label, showIf = "") => `
  <label class="field"${showAttr(showIf)}>
    <span class="field__label">${label}</span>
    <input type="time" id="ck_${id}" />
  </label>`;

const numField = (id, label, attrs = "", showIf = "", showChoice = "") => `
  <label class="field"${showAttr(showIf, showChoice)}>
    <span class="field__label">${label}</span>
    <input type="number" id="ck_${id}" ${attrs} />
  </label>`;

const textField = (id, label, attrs = "") => `
  <label class="field">
    <span class="field__label">${label}</span>
    <input type="text" id="ck_${id}" ${attrs} />
  </label>`;

const toggle = (id, label) => `
  <label class="setting-toggle">
    <input type="checkbox" id="ck_${id}" />
    <span>${label}</span>
  </label>`;

const constructHtml = (name) =>
  divider(CONSTRUCTS[name].title) + CONSTRUCTS[name].items.map((it) => likertRow(it.id, it.text)).join("");

/* سفر: تیک + یادداشت «از دیروز ادامه داده شد» */
const travelBlock = () =>
  toggle("travel", "امروز در سفر هستم / بودم") +
  `<p class="settings-hint" id="ck_travelNote" hidden>از دیروز ادامه داده شد — اگر برگشته‌ای تیک را بردار.</p>`;

/* قرص: key = Morning | Afternoon */
const medRow = (key, toggleLabel) =>
  `<div class="settings-options">` +
  toggle(`med${key}Taken`, toggleLabel) +
  `</div>` +
  choiceRow(`med${key}Amount`, "چقدر؟", AMOUNTS, `med${key}Taken`) +
  timeField(`med${key}Time`, "ساعت مصرف", `med${key}Taken`);

/* ---------- تغذیه ---------- */

const FLEX = "display:flex;flex-wrap:wrap;gap:6px";

const foodChip = (id, label) =>
  `<button type="button" class="preset-btn" data-food-id="${id}" aria-pressed="false">${label}</button>`;

const foodGroupHtml = (g) => `
  <details class="field">
    <summary class="field__label">${g.title}</summary>
    <div style="${FLEX};margin-top:8px">${g.items.map(([id, label]) => foodChip(id, label)).join("")}</div>
  </details>`;

const mealTabs = () => `
  <div class="preset-grid" style="grid-template-columns:repeat(4,1fr)">
    ${MEALS.map(
      (m) => `<button type="button" class="preset-btn" data-meal="${m.id}" aria-pressed="false">${m.title}</button>`
    ).join("")}
  </div>`;

const SECTIONS = {
  travel: () => divider("سفر") + `<div class="settings-options">` + travelBlock() + `</div>`,

  /* ورزش «دیروز» — جواب روی ورودی دیروز ذخیره می‌شود */
  exYesterday: () =>
    divider("ورزش دیروز") +
    choiceRow("exY", `دیروز (${prevDateKey(ctx.dateKey)}) ورزش کردی؟`, YES_NO) +
    numField("exYMin", "چند دقیقه؟", `min="0" max="600" inputmode="numeric"`, "", "exY:yes"),

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

  medMorning: () =>
    divider("قرص ADHD — صبح") +
    hint("اگر هنوز نخورده‌ای تیک را نزن؛ شب مقدار نهایی را اصلاح می‌کنی.") +
    medRow("Morning", "امروز صبح قرص خوردم"),

  medDay: () =>
    divider("قرص ADHD") +
    hint("صبح و عصر را جدا ثبت کن؛ ساعت مصرف برای تحلیل خواب مهم است.") +
    medRow("Morning", "صبح قرص خوردم") +
    medRow("Afternoon", "عصر / بعدازظهر هم قرص (یا نصف) خوردم"),

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
    hint("ورزش را فردا صبح (برای دیروز) ثبت می‌کنی.") +
    `<div class="settings-options">` +
    toggle("activity1", "فعالیت شماره ۱") +
    toggle("operation1", "عملیات د۱") +
    travelBlock() +
    `</div>`,

  mast: () =>
    divider("خودارضایی (امروز)") +
    `<div class="settings-options">` +
    toggle("mastPos", "مثبت — از روی میل و لذت") +
    numField("mastPosCount", "تعداد", `min="0" max="20" inputmode="numeric"`, "mastPos") +
    toggle("mastNeg", "منفی — از روی فشار روانی / اجبار") +
    numField("mastNegCount", "تعداد", `min="0" max="20" inputmode="numeric"`, "mastNeg") +
    `</div>`,

  explicit: () =>
    divider("محتوای تحریک‌آمیز (امروز)") +
    `<div class="settings-options">` +
    toggle("explicitViewed", "پورن یا صفحه‌های تحریک‌آمیز دیدم") +
    numField("explicitMin", "حدوداً چند دقیقه؟", `min="0" max="1440" inputmode="numeric"`, "explicitViewed") +
    `</div>` +
    choiceRow("explicitDriver", "بیشتر چطور بود؟", DRIVERS, "explicitViewed"),

  food: () =>
    divider("تغذیه") +
    hint("وعده را انتخاب کن و خوراکی‌هایی که خوردی را بزن (دوباره زدن = حذف).") +
    mealTabs() +
    `<div class="field">
       <span class="field__label">پرتکرارها</span>
       <div id="ck_frequent" style="${FLEX}"></div>
     </div>` +
    FOOD_GROUPS.map(foodGroupHtml).join("") +
    `<div id="ck_foodsum"></div>` +
    textField("foodOther", "غذا یا خوراکی دیگر (اختیاری)", `maxlength="200" autocomplete="off"`) +
    `<div class="settings-grid">` +
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

/* لایکرت (عدد) و choice (رشته) — هر دو با «دوباره‌زدن = پاک‌کردن» */
function paint(id) {
  const grid = bodyEl()?.querySelector(`[data-likert="${id}"], [data-choice="${id}"]`);
  if (!grid || !ctx) return;
  const cur = (grid.dataset.likert ? ctx.answers : ctx.choices)[id];
  grid.querySelectorAll(".preset-btn").forEach((b) => {
    const on = cur != null && String(cur) === b.dataset.v;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", String(on));
  });
}

function syncShowIf() {
  const root = bodyEl();
  if (!root || !ctx) return;
  root.querySelectorAll("[data-showif]").forEach((w) => {
    w.hidden = !$("ck_" + w.dataset.showif)?.checked;
  });
  root.querySelectorAll("[data-showchoice]").forEach((w) => {
    const [id, val] = w.dataset.showchoice.split(":");
    w.hidden = ctx.choices[id] !== val;
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
      w.querySelectorAll("[data-choice]").forEach((g) => {
        delete ctx.choices[g.dataset.choice];
        paint(g.dataset.choice);
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

/* ---------- غذا ---------- */

/* تعداد استفاده‌ی هر خوراکی در هر وعده، از تاریخچه */
function computeFoodFrequency() {
  const freq = { breakfast: {}, lunch: {}, dinner: {}, snack: {} };
  try {
    for (const e of DailyCheckinStore.getEntries()) {
      const log = e.food?.log;
      if (!log) continue;
      for (const m of Object.keys(freq)) {
        for (const id of log[m] || []) freq[m][id] = (freq[m][id] || 0) + 1;
      }
    }
  } catch (err) {
    console.warn("food frequency failed:", err);
  }
  return freq;
}

function renderFrequent() {
  const box = $("ck_frequent");
  if (!box || !ctx) return;
  const freq = ctx.freq[ctx.activeMeal] || {};
  const top = Object.entries(freq)
    .filter(([id]) => foodLabel(id))
    .sort((a, b) => b[1] - a[1])
    .slice(0, 10)
    .map(([id]) => id);
  box.innerHTML = top.length
    ? top.map((id) => foodChip(id, foodLabel(id))).join("")
    : `<span class="settings-hint">هنوز سابقه‌ای نیست؛ با ثبت چند روز، پرتکرارها اینجا می‌آیند.</span>`;
}

function paintFood() {
  const root = bodyEl();
  if (!root || !ctx || !$("ck_foodsum")) return;
  const sel = ctx.foodSel[ctx.activeMeal];

  root.querySelectorAll("[data-food-id]").forEach((b) => {
    const on = sel.has(b.dataset.foodId);
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", String(on));
  });
  root.querySelectorAll("[data-meal]").forEach((b) => {
    const on = b.dataset.meal === ctx.activeMeal;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", String(on));
  });

  $("ck_foodsum").innerHTML = MEALS.map((m) => {
    const ids = [...ctx.foodSel[m.id]];
    return `<p class="settings-hint"><b>${m.title}:</b> ${ids.length ? ids.map((id) => foodLabel(id) ?? id).join("، ") : "—"}</p>`;
  }).join("");
}

function setMeal(mealId) {
  ctx.activeMeal = mealId;
  renderFrequent();
  paintFood();
}

function toggleFood(id) {
  const sel = ctx.foodSel[ctx.activeMeal];
  if (sel.has(id)) sel.delete(id);
  else sel.add(id);
  paintFood();
}

/* ---------- fill ---------- */

function fill(e) {
  const set = (id, v) => {
    const n = $("ck_" + id);
    if (n) n.value = v == null ? "" : String(v);
  };
  const chk = (id, v) => {
    const n = $("ck_" + id);
    if (n) n.checked = !!v;
  };

  chk("travel", e.travel === true);

  set("bedTime", e.sleep?.bedTime);
  set("wakeTime", e.sleep?.wakeTime);
  set("hours", e.sleep?.hours);
  set("latency", e.sleep?.latencyMin);
  set("awakenings", e.sleep?.awakenings);

  chk("routineDone", e.relaxationRoutine?.done);
  set("routineSteps", e.relaxationRoutine?.steps);

  // قرص
  for (const [key, p] of [
    ["Morning", e.medication?.morning],
    ["Afternoon", e.medication?.afternoon],
  ]) {
    chk(`med${key}Taken`, p?.taken);
    set(`med${key}Time`, p?.time);
    if (p?.taken && p?.amount != null) ctx.choices[`med${key}Amount`] = String(p.amount);
  }

  chk("activity1", e.activity1 === true);
  chk("operation1", e.operation1 === true);

  chk("mastPos", e.masturbation?.positive?.done);
  set("mastPosCount", e.masturbation?.positive?.count);
  chk("mastNeg", e.masturbation?.negative?.done);
  set("mastNegCount", e.masturbation?.negative?.count);

  chk("explicitViewed", e.explicit?.viewed);
  set("explicitMin", e.explicit?.minutes);
  if (e.explicit?.viewed && e.explicit?.driver) ctx.choices.explicitDriver = e.explicit.driver;

  set("foodOther", e.food?.other);
  set("caffeine", e.food?.caffeine);
  chk("water", e.food?.water);

  set("notes", e.notes);
}

/* ---------- events (یک‌بار) ---------- */

function bind() {
  if (bound) return;
  const root = bodyEl();
  if (!root) return;
  bound = true;

  root.addEventListener("click", (ev) => {
    const btn = ev.target.closest(".preset-btn");
    if (!btn || !ctx) return;

    if (btn.dataset.meal) return setMeal(btn.dataset.meal);
    if (btn.dataset.foodId) return toggleFood(btn.dataset.foodId);

    const grid = btn.closest("[data-likert],[data-choice]");
    if (!grid) return;
    const isLikert = !!grid.dataset.likert;
    const id = grid.dataset.likert || grid.dataset.choice;
    const store = isLikert ? ctx.answers : ctx.choices;
    const v = isLikert ? Number(btn.dataset.v) : btn.dataset.v;

    if (store[id] === v) delete store[id]; // دوباره‌زدن = پاک‌کردن
    else store[id] = v;
    paint(id);

    // فیلدهای وابسته به انتخاب («چند دقیقه؟») نمایش/پاک شوند
    syncShowIf();
    root.querySelectorAll("[data-showchoice][hidden] input").forEach((i) => (i.value = ""));
    hideMsg();
  });

  root.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!ctx || t.type !== "checkbox") return;
    if (!t.checked) clearDependents(t.id.replace(/^ck_/, ""));
    syncShowIf();
    if (t.id === "ck_travel") {
      const note = $("ck_travelNote");
      if (note) note.hidden = true;
    }
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
      ? ["travel", "exYesterday", "sleep", "routine", "medMorning", "now"]
      : [
          ...(catchUp ? ["exYesterday", "sleep", "routine"] : []),
          "medDay",
          "mood", "stress", "energy", "focus", "anxiety",
          "activities", "mast", "explicit", "food", "day", "notes",
        ];

  const answers = {};
  for (const [k, v] of Object.entries(entry.items || {})) if (v != null) answers[k] = v;

  const foodSel = {};
  for (const m of MEALS) foodSel[m.id] = new Set(entry.food?.log?.[m.id] || []);

  ctx = {
    dateKey,
    slot,
    catchUp,
    sections,
    base: entry,
    answers,
    choices: {},
    foodSel,
    activeMeal: "breakfast",
    freq: computeFoodFrequency(),
    warned: false,
  };

  const intro =
    slot === "morning"
      ? "حدود ۱ دقیقه — ورزش دیروز، خواب دیشب، قرص صبح و حال همین الان."
      : "حدود ۲ تا ۳ دقیقه — هر جمله را برای کل امروز (تا همین لحظه) نمره بده: ۱ = اصلاً · ۵ = خیلی زیاد." +
        (catchUp ? " چون چک‌این صبح ثبت نشده، ورزش دیروز و بخش خواب و روتین هم اینجا آمده است." : "");

  root.innerHTML =
    hint(intro) + sections.map((s) => SECTIONS[s]()).join("") + `<p class="settings-hint" id="ck_msg" hidden></p>`;

  fill(entry);

  // سفر: اگر برای این روز هنوز ثبت نشده و دیروز در سفر بود، ادامه‌ی سفر پیش‌فرض است
  const travelEl = $("ck_travel");
  if (travelEl && entry.travel == null) {
    const prev = DailyCheckinStore.getEntryForDate(prevDateKey(dateKey));
    if (prev?.travel === true) {
      travelEl.checked = true;
      const note = $("ck_travelNote");
      if (note) note.hidden = false;
    }
  }

  // ورزش دیروز: اگر قبلاً ثبت شده، پر نشان بده
  if (sections.includes("exYesterday")) {
    const ex = DailyCheckinStore.getEntryForDate(prevDateKey(dateKey))?.exercise;
    if (ex?.recorded) {
      ctx.choices.exY = ex.done ? "yes" : "no";
      const m = $("ck_exYMin");
      if (m) m.value = ex.minutes == null ? "" : String(ex.minutes);
    }
  }

  syncShowIf();
  root.querySelectorAll("[data-likert],[data-choice]").forEach((g) => paint(g.dataset.likert || g.dataset.choice));
  renderFrequent();
  paintFood();
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

/* ورزش دیروز روی «ورودی دیروز» نوشته می‌شود (اگر ورودی‌اش نبود، ساخته می‌شود)
   تا تحلیل ورزش را روی روز درست ببیند. فقط بعد از موفق‌بودن همه‌ی اعتبارسنجی‌ها صدا زده می‌شود. */
function writeYesterdayExercise({ done, minutes }) {
  const yKey = prevDateKey(ctx.dateKey);
  const existing = DailyCheckinStore.getEntryForDate(yKey);
  const y = existing ? JSON.parse(JSON.stringify(existing)) : createCheckinEntry(yKey);
  y.exercise = { done, minutes: done ? minutes : null, recorded: true };
  DailyCheckinStore.saveCheckin(yKey, y);
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
  const rows = [...bodyEl().querySelectorAll("[data-likert],[data-choice]")].filter((g) => !g.closest("[hidden]"));
  const missing = rows.filter((g) =>
    g.dataset.likert ? answers[g.dataset.likert] == null : ctx.choices[g.dataset.choice] == null
  ).length;
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
  const str = (id, max = 500) => {
    const s = ($("ck_" + id)?.value ?? "").trim().slice(0, max);
    return s === "" ? null : s;
  };
  const checked = (id) => !!$("ck_" + id)?.checked;
  const choiceVal = (id) => ctx.choices[id] ?? null;

  const e = JSON.parse(JSON.stringify(ctx.base));
  const now = new Date().toISOString();

  // سفر (در هر دو چک‌این وجود دارد)
  const travelEl = $("ck_travel");
  if (travelEl) e.travel = travelEl.checked;

  // ورزش دیروز (بعد از موفق‌شدن اعتبارسنجی نوشته می‌شود)
  let yesterday = null;
  if (has("exYesterday")) {
    const v = choiceVal("exY");
    if (v === "yes" || v === "no") {
      yesterday = { done: v === "yes", minutes: v === "yes" ? int("exYMin", 0, 600) : null };
    }
  }

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

  // قرص ADHD
  if (has("medMorning") || has("medDay")) {
    const dose = (key) => {
      const taken = checked(`med${key}Taken`);
      const amt = choiceVal(`med${key}Amount`);
      return {
        taken,
        amount: taken && amt != null ? Number(amt) : null,
        time: taken ? str(`med${key}Time`) : null,
      };
    };
    e.medication = {
      ...e.medication,
      recorded: true,
      morning: dose("Morning"),
      ...(has("medDay") ? { afternoon: dose("Afternoon") } : {}),
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
    // ورزش امروز اینجا لمس نمی‌شود؛ فردا صبح ثبت می‌شود.

    const posDone = checked("mastPos");
    const negDone = checked("mastNeg");
    e.masturbation = {
      positive: { done: posDone, count: posDone ? int("mastPosCount", 0, 20) : null },
      negative: { done: negDone, count: negDone ? int("mastNegCount", 0, 20) : null },
    };

    const viewed = checked("explicitViewed");
    e.explicit = {
      recorded: true,
      viewed,
      minutes: viewed ? int("explicitMin", 0, 1440) : null,
      driver: viewed ? choiceVal("explicitDriver") : null,
    };

    // لاگ غذا: تعداد وعده‌ی اصلی خودکار؛ اگر هیچ‌چیز ثبت نشده → «ثبت‌نشده»
    const log = {};
    let anyFood = false;
    let mainMeals = 0;
    for (const m of MEALS) {
      log[m.id] = [...ctx.foodSel[m.id]];
      if (log[m.id].length) {
        anyFood = true;
        if (m.id !== "snack") mainMeals++;
      }
    }
    const other = str("foodOther", 200);
    const logged = anyFood || other != null;
    e.food = {
      ...e.food,
      meals: logged ? mainMeals : null,
      quality: single("f_quality"),
      water: checked("water"),
      caffeine: int("caffeine", 0, 20),
      log,
      other,
      logged,
    };

    e.dayRating = single("d_day");
    e.notes = str("notes");
  }

  e.items = { ...e.items, ...answers };
  e.slots = { ...e.slots, [slot]: now };
  if (ctx.catchUp) e.slots.morning = now;

  if (yesterday) writeYesterdayExercise(yesterday);

  return e;
}