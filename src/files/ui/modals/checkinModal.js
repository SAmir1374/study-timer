/* =============================================================
   ui/modals/checkinModal.js — Daily check-in modal (صبح / شب)
   Schema v6: modular sections, ADHD effect + side effects, reframed
   masturbation, exercise type/intensity, physical/social/events/
   circadian, responseMeta.
   ============================================================= */

import { MEALS, FOOD_GROUPS, foodLabel } from "../../daliycheck/foodCatalog.js";
import { DailyCheckinStore } from "../../daliycheck/dailyCheckinStore.js";
import {
  createCheckinEntry,
  prevDateKey,
  computeSleepHours,
} from "../../daliycheck/dailyCheckinData.js";

// re-export برای سازگاری با کدهای قبلی
export { computeSleepHours };

const $ = (id) => document.getElementById(id);
const bodyEl = () => $("checkinModalBody");

let ctx = null;
let bound = false;

/* ============================================================
   CONSTRUCTS — خلق / استرس / انرژی / تمرکز / اضطراب
   ۱ = اصلاً · ۵ = خیلی زیاد
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

/* ============================================================
   Static option lists
   ============================================================ */

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

const EXERCISE_TYPES = [
  ["taekwondo", "تکواندو"],
  ["bjj", "جیوجیتسو / بندسازی"],
  ["walking", "پیاده‌روی"],
  ["cardio", "هوازی"],
  ["strength", "قدرتی"],
  ["yoga", "یوگا / کشش"],
  ["sports", "ورزش تیمی"],
  ["other", "سایر"],
];

const EXERCISE_INTENSITIES = [
  ["light", "سبک"],
  ["moderate", "متوسط"],
  ["vigorous", "شدید"],
];

const EXERCISE_TIMES = [
  ["morning", "صبح"],
  ["afternoon", "بعدازظهر"],
  ["evening", "شب"],
];

const MAST_CONTEXTS = [
  ["stress", "استرس"],
  ["boredom", "بی‌حوصلگی"],
  ["habit", "عادت"],
  ["choice", "انتخاب"],
  ["other", "سایر"],
];

const EXPLICIT_CONTEXTS = [
  ["stress", "استرس"],
  ["boredom", "بی‌حوصلگی"],
  ["habit", "عادت"],
  ["choice", "انتخاب"],
  ["other", "سایر"],
];

const MED_SIDE_EFFECTS = [
  ["appetite_loss", "کاهش اشتها"],
  ["insomnia", "بی‌خوابی"],
  ["jitteriness", "بی‌قراری"],
  ["crash", "افت انرژی"],
  ["headache", "سردرد"],
  ["dry_mouth", "خشکی دهان"],
  ["irritability", "تحریک‌پذیری"],
  ["other", "سایر"],
];

const EVENT_TAGS = [
  ["conflict", "تعارض"],
  ["deadline", "ددلاین"],
  ["health", "سلامت"],
  ["money", "مالی"],
  ["family", "خانواده"],
  ["work", "کار"],
  ["social", "اجتماعی"],
  ["romantic", "عاطفی"],
  ["other", "سایر"],
];

/* ============================================================
   Scoring
   ============================================================ */

const round1 = (n) => Math.round(n * 10) / 10;
const to10 = (mean) => round1(1 + ((mean - 1) * 9) / 4); // 1–5 → 1–10

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
  if (vals.length < Math.max(2, Math.ceil(items.length * 0.66))) return null;
  return to10(vals.reduce((a, b) => a + b, 0) / vals.length);
}

/* ============================================================
   HTML builders
   ============================================================ */

const divider = (t) => `<div class="settings-divider">${t}</div>`;
const hint = (t) => `<p class="settings-hint">${t}</p>`;

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

const choiceRow = (id, text, options, showIf = "", showChoice = "") => `
  <div class="field"${showAttr(showIf, showChoice)}>
    <span class="field__label">${text}</span>
    <div class="preset-grid" data-choice="${id}" style="grid-template-columns:repeat(${Math.min(options.length, 6)},1fr)">
      ${options
        .map(([v, l]) => `<button type="button" class="preset-btn" data-v="${v}" aria-pressed="false">${l}</button>`)
        .join("")}
    </div>
  </div>`;

/* Severity 0–3 (as a choice row) */
const severityRow = (id, text, showIf = "", showChoice = "") => `
  <div class="field"${showAttr(showIf, showChoice)}>
    <span class="field__label">${text}</span>
    <div class="preset-grid" data-choice="${id}" style="grid-template-columns:repeat(4,1fr)">
      ${[["0", "هیچ"], ["1", "کم"], ["2", "متوسط"], ["3", "شدید"]]
        .map(([v, l]) => `<button type="button" class="preset-btn" data-v="${v}" aria-pressed="false">${l}</button>`)
        .join("")}
    </div>
  </div>`;

/* 0–10 VAS as numeric input */
const vasField = (id, label, showIf = "", showChoice = "") => `
  <label class="field"${showAttr(showIf, showChoice)}>
    <span class="field__label">${label}</span>
    <input type="number" id="ck_${id}" min="0" max="10" step="1" inputmode="numeric"
           placeholder="۰ = هیچ … ۱۰ = عالی" />
  </label>`;

/* Chip row (single-select, flex-wrap — for many options) */
const chipRow = (id, text, options, showIf = "", showChoice = "") => `
  <div class="field"${showAttr(showIf, showChoice)}>
    <span class="field__label">${text}</span>
    <div style="display:flex;flex-wrap:wrap;gap:6px" data-choice="${id}">
      ${options.map(([v, l]) => `<button type="button" class="preset-btn" data-v="${v}" aria-pressed="false">${l}</button>`).join("")}
    </div>
  </div>`;

/* Multi-select chip row */
const multiChipRow = (id, text, options, showIf = "", showChoice = "") => `
  <div class="field"${showAttr(showIf, showChoice)}>
    <span class="field__label">${text}</span>
    <div style="display:flex;flex-wrap:wrap;gap:6px" data-multichoice="${id}">
      ${options.map(([v, l]) => `<button type="button" class="preset-btn" data-mv="${v}" aria-pressed="false">${l}</button>`).join("")}
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

/* سفر: تیک + یادداشت ادامه از دیروز */
const travelBlock = () =>
  toggle("travel", "امروز در سفر هستم / بودم") +
  `<p class="settings-hint" id="ck_travelNote" hidden>از دیروز ادامه داده شد — اگر برگشته‌ای تیک را بردار.</p>`;

/* قرص */
const medRow = (key, toggleLabel) =>
  `<div class="settings-options">` +
  toggle(`med${key}Taken`, toggleLabel) +
  `</div>` +
  choiceRow(`med${key}Amount`, "چقدر؟", AMOUNTS, `med${key}Taken`) +
  timeField(`med${key}Time`, "ساعت مصرف", `med${key}Taken`);

/* ---------- Nutrition ---------- */

const FLEX = "display:flex;flex-wrap:wrap;gap:6px";

const foodChip = (id, label) =>
  `<button type="button" class="preset-btn ck-food__chip" data-food-id="${id}" aria-pressed="false">${label}</button>`;

const foodGroupHtml = (g) => `
  <details class="ck-food__group" data-food-group="${g.id}">
    <summary>
      <span>${g.title}</span>
      <span class="ck-food__group-count" data-group-count="${g.id}" data-count="0"></span>
    </summary>
    <div class="ck-food__group-body">
      <div class="ck-food__chips">
        ${g.items.map(([id, label]) => foodChip(id, label)).join("")}
      </div>
    </div>
  </details>`;

const mealTabs = () => `
  <div class="ck-food__meals">
    ${MEALS.map(
      (m) => `
      <button type="button" class="preset-btn ck-food__meal-tab" data-meal="${m.id}" aria-pressed="false">
        ${m.title}
        <span class="ck-food__meal-count" data-count="0" data-meal-count="${m.id}"></span>
      </button>`
    ).join("")}
  </div>`;

/* ============================================================
   SECTIONS
   ============================================================ */

const SECTIONS = {
  travel: () => divider("سفر") + `<div class="settings-options">` + travelBlock() + `</div>`,

  /* ورزش دیروز — روی ورودی دیروز ذخیره می‌شود */
  exYesterday: () =>
    divider("ورزش دیروز") +
    choiceRow("exY", `دیروز (${prevDateKey(ctx.dateKey)}) ورزش کردی؟`, YES_NO) +
    numField("exYMin", "چند دقیقه؟", `min="0" max="600" inputmode="numeric"`, "", "exY:yes") +
    chipRow("exYType", "چه ورزشی؟", EXERCISE_TYPES, "", "exY:yes") +
    choiceRow("exYIntensity", "شدت", EXERCISE_INTENSITIES, "", "exY:yes") +
    choiceRow("exYTime", "چه موقعی از روز؟", EXERCISE_TIMES, "", "exY:yes"),

  sleep: () =>
    divider("خواب دیشب") +
    `<div class="settings-grid">` +
    timeField("bedTime", "ساعت خواب") +
    timeField("wakeTime", "ساعت بیداری") +
    numField("hours", "مدت خواب (ساعت — خودکار)", `min="0" max="24" step="0.1" inputmode="decimal"`) +
    numField("latency", "چند دقیقه طول کشید تا خوابت ببرد؟", `min="0" max="600" inputmode="numeric"`) +
    numField("awakenings", "چند بار شب بیدار شدی؟", `min="0" max="20" inputmode="numeric"`) +
    numField("naps", "چرت روزانه (دقیقه)", `min="0" max="300" inputmode="numeric"`) +
    timeField("lastCaffeineTime", "آخرین کافئین دیشب قبل خواب") +
    numField("screenBeforeBed", "صفحه‌نمایش قبل خواب (دقیقه)", `min="0" max="300" inputmode="numeric"`) +
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
    medRow("Morning", "امروز صبح قرص خوردم") +
    vasField("medMorningEffect", "اثر قرص صبح (۰ = هیچ، ۱۰ = عالی)", "medMorningTaken") +
    multiChipRow("medMorningSide", "عوارض صبح", MED_SIDE_EFFECTS, "medMorningTaken"),

  medDay: () =>
    divider("قرص ADHD") +
    hint("صبح و عصر را جدا ثبت کن؛ اثر و عوارض فقط اگر خوردی.") +
    medRow("Morning", "صبح قرص خوردم") +
    vasField("medMorningEffect", "اثر قرص صبح (۰ = هیچ، ۱۰ = عالی)", "medMorningTaken") +
    multiChipRow("medMorningSide", "عوارض صبح", MED_SIDE_EFFECTS, "medMorningTaken") +
    medRow("Afternoon", "عصر / بعدازظهر هم قرص (یا نصف) خوردم") +
    vasField("medAfternoonEffect", "اثر قرص عصر (۰ = هیچ، ۱۰ = عالی)", "medAfternoonTaken") +
    multiChipRow("medAfternoonSide", "عوارض عصر", MED_SIDE_EFFECTS, "medAfternoonTaken"),

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

  wellbeing: () =>
    divider("احساسات و معنا") +
    hint("۱ = اصلاً · ۵ = خیلی زیاد") +
    likertRow("irritability", "امروز زود عصبانی یا بی‌حوصله می‌شدم") +
    likertRow("anhedonia", "از چیزهایی که قبلاً لذت می‌بردم، امروز لذت نبردم") +
    likertRow("rumination", "افکار تکراری و مزاحم داشتم که نمی‌تونستم متوقفشون کنم") +
    likertRow("meaningfulness", "امروز حس کردم کارهام معنادار است"),

  adhd: () =>
    divider("تمرکز و ADHD") +
    hint("۱ = اصلاً · ۵ = خیلی زیاد") +
    likertRow("focusQuality", "امروز روی کارهام خوب تمرکز می‌کردم") +
    likertRow("taskProcrastination", "شروع کارها را به تعویق انداختم") +
    likertRow("emotionalDysregulation", "احساساتم را سخت کنترل می‌کردم"),

  physical: () =>
    divider("علائم جسمی") +
    severityRow("physHeadache", "سردرد") +
    severityRow("physBodyPain", "درد بدن") +
    severityRow("physFatigue", "خستگی غیرمعمول") +
    severityRow("physDigestive", "مشکل گوارشی"),

  social: () =>
    divider("ارتباط اجتماعی") +
    `<div class="settings-options">` +
    toggle("socialContact", "امروز ارتباط معنادار با کسی داشتم") +
    `</div>` +
    likertRow("socialLonely", "احساس تنهایی می‌کردم"),

  events: () =>
    divider("رویدادها") +
    severityRow("eventsStressors", "تعداد رویدادهای استرس‌زا") +
    multiChipRow("eventTags", "چه نوع؟ (چندتایی)", EVENT_TAGS),

  circadian: () =>
    divider("ریتم شبانه‌روزی") +
    numField("circMorningLight", "نور بیرون در صبح (دقیقه — ۰ تا ۱۸۰)", `min="0" max="180" inputmode="numeric"`) +
    `<div class="settings-options">` +
    toggle("circEveningBright", "شب در معرض نور شدید (صفحه/لامپ) بودم") +
    `</div>`,

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
    `<div class="settings-options">` + toggle("mastDone", "انجام دادم") + `</div>` +
    numField("mastCount", "تعداد", `min="0" max="20" inputmode="numeric"`, "mastDone") +
    severityRow("mastUrge", "شدت میل / فشار درونی", "mastDone") +
    severityRow("mastGuilt", "احساس گناه یا پشیمانی", "mastDone") +
    chipRow("mastContext", "بیشتر از چه بابت؟", MAST_CONTEXTS, "mastDone"),

  explicit: () =>
    divider("محتوای تحریک‌آمیز (امروز)") +
    `<div class="settings-options">` + toggle("explicitViewed", "پورن یا صفحه‌های تحریک‌آمیز دیدم") + `</div>` +
    numField("explicitMin", "حدوداً چند دقیقه؟", `min="0" max="1440" inputmode="numeric"`, "explicitViewed") +
    choiceRow("explicitDriver", "بیشتر چطور بود؟", DRIVERS, "explicitViewed") +
    severityRow("explicitRegret", "احساس پشیمانی", "explicitViewed") +
    chipRow("explicitContext", "بیشتر از چه بابت؟", EXPLICIT_CONTEXTS, "explicitViewed"),

  food: () =>
  divider("تغذیه") +
  hint("وعده را انتخاب کن، خوراکی‌ها را بزن (دوباره زدن = حذف)، و در صورت نیاز جستجو کن.") +
  `<div class="ck-food">
     ${mealTabs()}
     <div class="ck-food__search">
       <input type="text" id="ck_foodSearch" placeholder="جستجوی خوراکی (مثلاً: برنج، تخم‌مرغ، پیتزا)…" autocomplete="off" />
     </div>
     <div class="ck-food__section">
       <div class="ck-food__section-title">پرتکرارها</div>
       <div class="ck-food__chips" id="ck_frequent"></div>
     </div>
     ${FOOD_GROUPS.map(foodGroupHtml).join("")}
     <div class="ck-food__summary" id="ck_foodsum"></div>
   </div>` +
  `<div style="margin-top:10px">` +
  textField("foodOther", "غذا یا خوراکی دیگر (اختیاری)", `maxlength="200" autocomplete="off"`) +
  `</div>` +
  `<div class="settings-grid">` +
  numField("waterGlasses", "لیوان آب (۰–۱۵)", `min="0" max="15" inputmode="numeric"`) +
  numField("caffeineCups", "قهوه / چای / انرژی‌زا (لیوان)", `min="0" max="10" inputmode="numeric"`) +
  timeField("caffeineLastTime", "آخرین کافئین امروز") +
  numField("sugarEpisodes", "دفعات مصرف قند / شیرینی امروز", `min="0" max="10" inputmode="numeric"`) +
  timeField("firstMealTime", "اولین وعده (ساعت)") +
  timeField("lastMealTime", "آخرین وعده (ساعت)") +
  `</div>` +
  likertRow("f_quality", "کیفیت تغذیه‌ی امروز (۱ = خیلی بد، ۵ = عالی)") +
  `<div class="settings-options">` + toggle("water", "آب کافی خوردی؟") + `</div>`,

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
   Sleep-hours auto-fill
   ============================================================ */

export function recalcSleepHours() {
  const hours = computeSleepHours($("ck_bedTime")?.value || "", $("ck_wakeTime")?.value || "");
  if (hours == null) return;
  const out = $("ck_hours");
  if (out) out.value = String(hours);
}

/* ============================================================
   UI helpers
   ============================================================ */

function localKey(d = new Date()) {
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
}

function inferSlot(entry, now = new Date()) {
  const h = now.getHours();
  if (h >= 18 || h < 4) return "evening";
  return entry?.slots?.morning ? "evening" : "morning";
}

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

function paintMulti(id) {
  const grid = bodyEl()?.querySelector(`[data-multichoice="${id}"]`);
  if (!grid || !ctx) return;
  const set = ctx.multiChoices[id] || new Set();
  grid.querySelectorAll(".preset-btn").forEach((b) => {
    const on = set.has(b.dataset.mv);
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
      w.querySelectorAll("[data-multichoice]").forEach((g) => {
        const id = g.dataset.multichoice;
        ctx.multiChoices[id]?.clear();
        paintMulti(id);
      });
    });
}

function clearHiddenDependents() {
  const root = bodyEl();
  if (!root || !ctx) return;
  root.querySelectorAll("[data-showchoice][hidden]").forEach((w) => {
    w.querySelectorAll("input").forEach((i) => (i.value = ""));
    w.querySelectorAll("[data-likert]").forEach((g) => {
      delete ctx.answers[g.dataset.likert];
      paint(g.dataset.likert);
    });
    w.querySelectorAll("[data-choice]").forEach((g) => {
      delete ctx.choices[g.dataset.choice];
      paint(g.dataset.choice);
    });
    w.querySelectorAll("[data-multichoice]").forEach((g) => {
      const id = g.dataset.multichoice;
      ctx.multiChoices[id]?.clear();
      paintMulti(id);
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

/* ---------- Food ---------- */

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

  // 1) Chips active state
  root.querySelectorAll("[data-food-id]").forEach((b) => {
    const on = sel.has(b.dataset.foodId);
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", String(on));
  });

  // 2) Meal tabs active state
  root.querySelectorAll("[data-meal]").forEach((b) => {
    const on = b.dataset.meal === ctx.activeMeal;
    b.classList.toggle("is-active", on);
    b.setAttribute("aria-pressed", String(on));
  });

  // 3) Meal tab counts
  root.querySelectorAll("[data-meal-count]").forEach((el) => {
    const n = ctx.foodSel[el.dataset.mealCount]?.size || 0;
    el.textContent = n > 0 ? String(n) : "";
    el.dataset.count = String(n);
  });

  // 4) Group counts (per currently active meal)
  root.querySelectorAll("[data-group-count]").forEach((el) => {
    const groupId = el.dataset.groupCount;
    const group = FOOD_GROUPS.find((g) => g.id === groupId);
    if (!group) return;
    const n = group.items.filter(([id]) => sel.has(id)).length;
    el.textContent = n > 0 ? String(n) : "";
    el.dataset.count = String(n);
  });

  // 5) Summary (all meals)
  $("ck_foodsum").innerHTML = MEALS.map((m) => {
    const ids = [...ctx.foodSel[m.id]];
    const active = m.id === ctx.activeMeal ? "1" : "0";
    return `<div class="ck-food__summary-row" data-active="${active}">
      <span class="ck-food__summary-meal">${m.title}</span>
      <span class="ck-food__summary-items">${ids.length ? ids.map((id) => foodLabel(id) ?? id).join("، ") : "—"}</span>
    </div>`;
  }).join("");
}

function setMeal(mealId) {
  ctx.activeMeal = mealId;
  renderFrequent();
  paintFood();
  const q = $("ck_foodSearch")?.value;
  if (q) filterFoods(q); // ← این خط
}

function toggleFood(id) {
  const sel = ctx.foodSel[ctx.activeMeal];
  if (sel.has(id)) sel.delete(id);
  else sel.add(id);
  paintFood();
}

/* ---------- Food search ---------- */

function normalizeFa(s) {
  if (!s) return "";
  return String(s)
    .replace(/[يى]/g, "ی")
    .replace(/ك/g, "ک")
    .replace(/[\u064B-\u0652\u0670]/g, "") // اعراب
    .replace(/\u200c/g, "") // نیم‌فاصله
    .toLowerCase()
    .trim();
}

function filterFoods(query) {
  const root = bodyEl();
  if (!root) return;
  const q = normalizeFa(query);

  root.querySelectorAll(".ck-food__group").forEach((groupEl) => {
    const groupId = groupEl.dataset.foodGroup;
    const group = FOOD_GROUPS.find((g) => g.id === groupId);
    if (!group) return;

    let visibleCount = 0;
    groupEl.querySelectorAll("[data-food-id]").forEach((chip) => {
      const id = chip.dataset.foodId;
      const label = normalizeFa(foodLabel(id) || "");
      const idNorm = normalizeFa(id);
      const groupTitle = normalizeFa(group.title);
      const matches = !q || label.includes(q) || idNorm.includes(q) || groupTitle.includes(q);
      chip.style.display = matches ? "" : "none";
      if (matches) visibleCount++;
    });

    if (q) {
      groupEl.style.display = visibleCount > 0 ? "" : "none";
      if (visibleCount > 0) groupEl.open = true;
    } else {
      groupEl.style.display = "";
      // وقتی جستجو پاک شد، گروه‌ها را در حالت اولیه (بسته) بگذار
      groupEl.open = false;
    }
  });
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

  // sleep
  set("bedTime", e.sleep?.bedTime);
  set("wakeTime", e.sleep?.wakeTime);
  set("hours", e.sleep?.hours);
  set("latency", e.sleep?.latencyMin);
  set("awakenings", e.sleep?.awakenings);
  set("naps", e.sleep?.napsMin);
  set("lastCaffeineTime", e.sleep?.lastCaffeineTime);
  set("screenBeforeBed", e.sleep?.screenBeforeBedMin);

  // routine
  chk("routineDone", e.relaxationRoutine?.done);
  set("routineSteps", e.relaxationRoutine?.steps);

  // medication
  for (const [key, p] of [
    ["Morning", e.medication?.morning],
    ["Afternoon", e.medication?.afternoon],
  ]) {
    chk(`med${key}Taken`, p?.taken);
    set(`med${key}Time`, p?.time);
    set(`med${key}Effect`, p?.effect);
    if (p?.taken && p?.amount != null) ctx.choices[`med${key}Amount`] = String(p.amount);
    for (const se of p?.sideEffects || []) {
      ctx.multiChoices[`med${key}Side`]?.add(se);
    }
  }

  chk("activity1", e.activity1 === true);
  chk("operation1", e.operation1 === true);

  // masturbation
  chk("mastDone", e.masturbation?.done === true);
  set("mastCount", e.masturbation?.count);
  if (e.masturbation?.urgeIntensity != null) ctx.choices.mastUrge = String(e.masturbation.urgeIntensity);
  if (e.masturbation?.guilt != null) ctx.choices.mastGuilt = String(e.masturbation.guilt);
  if (e.masturbation?.context) ctx.choices.mastContext = e.masturbation.context;

  // explicit
  chk("explicitViewed", e.explicit?.viewed);
  set("explicitMin", e.explicit?.minutes);
  if (e.explicit?.viewed && e.explicit?.driver) ctx.choices.explicitDriver = e.explicit.driver;
  if (e.explicit?.regret != null) ctx.choices.explicitRegret = String(e.explicit.regret);
  if (e.explicit?.context) ctx.choices.explicitContext = e.explicit.context;

  // physical
  if (e.physical?.headache != null) ctx.choices.physHeadache = String(e.physical.headache);
  if (e.physical?.bodyPain != null) ctx.choices.physBodyPain = String(e.physical.bodyPain);
  if (e.physical?.fatigueBeyond != null) ctx.choices.physFatigue = String(e.physical.fatigueBeyond);
  if (e.physical?.digestive != null) ctx.choices.physDigestive = String(e.physical.digestive);

  // social
  chk("socialContact", e.social?.meaningfulContact === true);
  if (e.social?.loneliness != null) ctx.answers.socialLonely = e.social.loneliness;

  // events
  if (e.events?.stressorCount != null) ctx.choices.eventsStressors = String(e.events.stressorCount);
  for (const t of e.events?.tags || []) ctx.multiChoices.eventTags?.add(t);

  // circadian
  set("circMorningLight", e.circadian?.morningOutdoorLight);
  chk("circEveningBright", e.circadian?.eveningBrightLight === true);

  // food
  set("foodOther", e.food?.other);
  set("caffeine", e.food?.caffeine);
  set("waterGlasses", e.food?.waterGlasses);
  set("caffeineCups", e.food?.caffeineCups);
  set("caffeineLastTime", e.food?.caffeineLastTime);
  set("sugarEpisodes", e.food?.sugarEpisodes);
  set("firstMealTime", e.food?.firstMealTime);
  set("lastMealTime", e.food?.lastMealTime);
  chk("water", e.food?.water);

  // notes
  set("notes", e.notes);
}

/* ---------- events (once) ---------- */

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

    // Multi-select chips
    if (btn.dataset.mv) {
      const grid = btn.closest("[data-multichoice]");
      if (!grid) return;
      const id = grid.dataset.multichoice;
      const set = ctx.multiChoices[id];
      if (!set) return;
      const v = btn.dataset.mv;
      if (set.has(v)) set.delete(v);
      else set.add(v);
      btn.classList.toggle("is-active", set.has(v));
      btn.setAttribute("aria-pressed", String(set.has(v)));
      hideMsg();
      return;
    }

    // Single-select (likert / choice)
    const grid = btn.closest("[data-likert],[data-choice]");
    if (!grid) return;
    const isLikert = !!grid.dataset.likert;
    const id = grid.dataset.likert || grid.dataset.choice;
    const store = isLikert ? ctx.answers : ctx.choices;
    const v = isLikert ? Number(btn.dataset.v) : btn.dataset.v;

    if (store[id] === v) delete store[id];
    else store[id] = v;
    paint(id);

    syncShowIf();
    clearHiddenDependents();
    hideMsg();
  });

  root.addEventListener("change", (ev) => {
    const t = ev.target;
    if (!ctx || t.type !== "checkbox") return;
    if (!t.checked) clearDependents(t.id.replace(/^ck_/, ""));
    syncShowIf();
    clearHiddenDependents();
    if (t.id === "ck_travel") {
      const note = $("ck_travelNote");
      if (note) note.hidden = true;
    }
  });

root.addEventListener("input", (ev) => {
  if (ev.target.id === "ck_bedTime" || ev.target.id === "ck_wakeTime") recalcSleepHours();
  if (ev.target.id === "ck_foodSearch") filterFoods(ev.target.value);
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
          "wellbeing", "adhd",
          "physical", "social", "events", "circadian",
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
    multiChoices: {
      medMorningSide: new Set(),
      medAfternoonSide: new Set(),
      eventTags: new Set(),
    },
    foodSel,
    activeMeal: "breakfast",
    freq: computeFoodFrequency(),
    warned: false,
    startedAt: Date.now(),
  };

  const intro =
    slot === "morning"
      ? "حدود ۱ دقیقه — ورزش دیروز، خواب دیشب، قرص صبح و حال همین الان."
      : "حدود ۳ دقیقه — هر جمله را برای کل امروز (تا همین لحظه) نمره بده: ۱ = اصلاً · ۵ = خیلی زیاد." +
        (catchUp ? " چون چک‌این صبح ثبت نشده، ورزش دیروز و بخش خواب و روتین هم اینجا آمده است." : "");

  root.innerHTML =
    hint(intro) + sections.map((s) => SECTIONS[s]()).join("") + `<p class="settings-hint" id="ck_msg" hidden></p>`;

  fill(entry);

  // سفر: ادامه‌ی سفر از دیروز
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
      if (ex.type) ctx.choices.exYType = ex.type;
      if (ex.intensity) ctx.choices.exYIntensity = ex.intensity;
      if (ex.timeOfDay) ctx.choices.exYTime = ex.timeOfDay;
    }
  }

  syncShowIf();
  root.querySelectorAll("[data-likert]").forEach((g) => paint(g.dataset.likert));
  root.querySelectorAll("[data-choice]").forEach((g) => paint(g.dataset.choice));
  root.querySelectorAll("[data-multichoice]").forEach((g) => paintMulti(g.dataset.multichoice));
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

/* نوشتن ورزش دیروز روی ورودی دیروز */
function writeYesterdayExercise({ done, minutes, type, intensity, timeOfDay }) {
  const yKey = prevDateKey(ctx.dateKey);
  const existing = DailyCheckinStore.getEntryForDate(yKey);
  const y = existing ? JSON.parse(JSON.stringify(existing)) : createCheckinEntry(yKey);
  y.exercise = {
    done,
    minutes: done ? minutes : null,
    recorded: true,
    type: done ? type : null,
    intensity: done ? intensity : null,
    timeOfDay: done ? timeOfDay : null,
  };
  DailyCheckinStore.saveCheckin(yKey, y);
}

/* ============================================================
   read → entry
   ============================================================ */

const clamp = (n, lo, hi) => (n == null ? null : Math.min(hi, Math.max(lo, n)));

export function readCheckinForm() {
  if (!ctx) return null;
  const { slot, sections, answers } = ctx;
  const has = (name) => sections.includes(name);

  // هشدار نرم برای فیلدهای خالی
  const rows = [...bodyEl().querySelectorAll("[data-likert],[data-choice]")].filter(
    (g) => !g.closest("[hidden]")
  );
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

  // travel
  const travelEl = $("ck_travel");
  if (travelEl) e.travel = travelEl.checked;

  // yesterday exercise
  let yesterday = null;
  if (has("exYesterday")) {
    const v = choiceVal("exY");
    if (v === "yes" || v === "no") {
      yesterday = {
        done: v === "yes",
        minutes: v === "yes" ? int("exYMin", 0, 600) : null,
        type: v === "yes" ? choiceVal("exYType") : null,
        intensity: v === "yes" ? choiceVal("exYIntensity") : null,
        timeOfDay: v === "yes" ? choiceVal("exYTime") : null,
      };
    }
  }

  // sleep
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
      napsMin: int("naps", 0, 300),
      lastCaffeineTime: str("lastCaffeineTime"),
      screenBeforeBedMin: int("screenBeforeBed", 0, 300),
      quality: single("s_quality"),
      restedness: single("s_rested"),
    };
  }

  // routine
  if (has("routine")) {
    const done = checked("routineDone");
    e.relaxationRoutine = {
      done,
      steps: done ? int("routineSteps", 0, 100) : null,
      effectiveness: done ? single("r_eff") : null,
    };
  }

  // medication
  if (has("medMorning") || has("medDay")) {
    const dose = (key) => {
      const taken = checked(`med${key}Taken`);
      const amt = choiceVal(`med${key}Amount`);
      return {
        taken,
        amount: taken && amt != null ? Number(amt) : null,
        time: taken ? str(`med${key}Time`) : null,
        effect: taken ? num(`med${key}Effect`) : null,
        sideEffects: taken ? [...(ctx.multiChoices[`med${key}Side`] || [])] : [],
      };
    };
    e.medication = {
      ...e.medication,
      recorded: true,
      morning: dose("Morning"),
      ...(has("medDay") ? { afternoon: dose("Afternoon") } : {}),
    };
  }

  // morning "now"
  if (has("now")) {
    e.morningState = {
      mood: single("n_mood"),
      energy: single("n_energy"),
      tension: single("n_tension"),
    };
  }

  // physical
  if (has("physical")) {
    const pick = (id) => (ctx.choices[id] != null ? Number(ctx.choices[id]) : null);
    e.physical = {
      headache: pick("physHeadache"),
      bodyPain: pick("physBodyPain"),
      fatigueBeyond: pick("physFatigue"),
      digestive: pick("physDigestive"),
    };
  }

  // social
  if (has("social")) {
    e.social = {
      meaningfulContact: $("ck_socialContact")?.checked ?? null,
      loneliness: answers.socialLonely ?? null,
    };
  }

  // events
  if (has("events")) {
    e.events = {
      stressorCount:
        ctx.choices.eventsStressors != null ? Number(ctx.choices.eventsStressors) : null,
      tags: [...(ctx.multiChoices.eventTags || [])],
    };
  }

  // circadian
  if (has("circadian")) {
    e.circadian = {
      morningOutdoorLight: int("circMorningLight", 0, 180),
      eveningBrightLight: $("ck_circEveningBright")?.checked ?? null,
    };
  }

  // evening-only composites
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

    // masturbation (reframe)
    const mastDone = checked("mastDone");
    e.masturbation = {
      recorded: true,
      done: mastDone,
      count: mastDone ? int("mastCount", 0, 20) : null,
      urgeIntensity:
        mastDone && ctx.choices.mastUrge != null ? Number(ctx.choices.mastUrge) : null,
      guilt: mastDone && ctx.choices.mastGuilt != null ? Number(ctx.choices.mastGuilt) : null,
      context: mastDone ? choiceVal("mastContext") : null,
    };

    // explicit
    const viewed = checked("explicitViewed");
    e.explicit = {
      recorded: true,
      viewed,
      minutes: viewed ? int("explicitMin", 0, 1440) : null,
      driver: viewed ? choiceVal("explicitDriver") : null,
      regret: viewed && ctx.choices.explicitRegret != null ? Number(ctx.choices.explicitRegret) : null,
      context: viewed ? choiceVal("explicitContext") : null,
    };

    // food
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
      waterGlasses: int("waterGlasses", 0, 15),
      caffeine: int("caffeine", 0, 20),
      caffeineCups: int("caffeineCups", 0, 10),
      caffeineLastTime: str("caffeineLastTime"),
      sugarEpisodes: int("sugarEpisodes", 0, 10),
      firstMealTime: str("firstMealTime"),
      lastMealTime: str("lastMealTime"),
      log,
      other,
      logged,
    };

    e.dayRating = single("d_day");
    e.notes = str("notes");
  }

  // responseMeta
  const metaRows = [...bodyEl().querySelectorAll("[data-likert],[data-choice]")].filter(
    (g) => !g.closest("[hidden]")
  );
  const answered = metaRows.filter((g) =>
    g.dataset.likert ? answers[g.dataset.likert] != null : ctx.choices[g.dataset.choice] != null
  ).length;
  e.responseMeta = {
    ...e.responseMeta,
    [slot]: {
      startedAt: new Date(ctx.startedAt).toISOString(),
      completedAt: new Date().toISOString(),
      durationMs: Date.now() - ctx.startedAt,
      itemsAnswered: answered,
      itemsSkipped: Math.max(0, metaRows.length - answered),
    },
  };

  e.items = { ...e.items, ...answers };
  e.slots = { ...e.slots, [slot]: now };
  if (ctx.catchUp) e.slots.morning = now;

  if (yesterday) writeYesterdayExercise(yesterday);

  return e;
}