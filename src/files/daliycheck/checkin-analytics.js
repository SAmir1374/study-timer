/* =============================================================
   checkin-analytics.js — صفحه‌ی تحلیل چک‌این روزانه
   ============================================================= */

import { parseCheckinDocument } from "./dailyCheckinData.js";
import { FileStorage } from "../fileStorage.js";

const LOCAL_BACKUP_KEY = "study-timer:daily-checkins-backup";
const HANDLE_KEY = "study-timer:daily-checkins-handle";

let doc = null;
let allEntries = [];      // مرتب‌شده صعودی بر اساس تاریخ
let visibleEntries = [];  // بعد از فیلتر بازه

const $ = (id) => document.getElementById(id);

/* ============================================================
   Load
   ============================================================ */

async function init() {
  bindEvents();

  // 1) از localStorage backup
  if (loadFromBackup()) { render(); return; }

  // 2) تلاش برای اتصال خودکار به فایل ذخیره‌شده
  try {
    const remembered = await FileStorage.loadHandle(HANDLE_KEY);
    if (remembered) {
      if (await FileStorage.ensurePermission(remembered, false)) {
        await loadFromHandle(remembered, { silent: true });
        render();
        return;
      }
    }
  } catch (err) {
    console.warn("Auto-connect failed:", err);
  }

  render();
}

function loadFromBackup() {
  try {
    const raw = localStorage.getItem(LOCAL_BACKUP_KEY);
    if (!raw) return false;
    doc = parseCheckinDocument(raw);
    allEntries = normalizeEntries(doc.entries);
    return true;
  } catch (err) {
    console.warn("Backup load failed:", err);
    return false;
  }
}

async function loadFromHandle(handle, { silent = false } = {}) {
  const text = await FileStorage.readText(handle);
  if (!text.trim()) return false;
  doc = parseCheckinDocument(text);
  allEntries = normalizeEntries(doc.entries);
  if (!silent) {
    try {
      localStorage.setItem(LOCAL_BACKUP_KEY, text);
    } catch {}
  }
  return true;
}

async function connectFile() {
  try {
    const h = await FileStorage.pickOpenFile();
    await FileStorage.saveHandle(h, HANDLE_KEY);
    await loadFromHandle(h);
    render();
  } catch (err) {
    if (err?.name !== "AbortError") {
      console.error(err);
      alert("خطا در باز کردن فایل: " + (err.message || err));
    }
  }
}

async function importFile(file) {
  try {
    const text = await file.text();
    doc = parseCheckinDocument(text);
    allEntries = normalizeEntries(doc.entries);
    try {
      localStorage.setItem(LOCAL_BACKUP_KEY, text);
    } catch {}
    render();
  } catch (err) {
    console.error(err);
    alert("فایل نامعتبر است: " + (err.message || err));
  }
}

/* ============================================================
   Normalize
   ============================================================ */

function normalizeEntries(raw) {
  return raw
    .map((e) => ({
      date: e.date,
      bedTime: e.sleep?.bedTime ?? null,
      wakeTime: e.sleep?.wakeTime ?? null,
      sleepHours: numOr(e.sleep?.hours),
      sleepQuality: numOr(e.sleep?.quality),
      routineDone: !!e.relaxationRoutine?.done,
      routineEff: numOr(e.relaxationRoutine?.effectiveness),
      routineSteps: numOr(e.relaxationRoutine?.steps),
      mood: numOr(e.mood?.rating),
      stress: numOr(e.mood?.stress),
      energy: numOr(e.mood?.energy),
      activity1: e.activity1,
      operation1: e.operation1,
      exerciseDone: !!e.exercise?.done,
      exerciseMin: numOr(e.exercise?.minutes),
      mastPos: !!e.masturbation?.positive?.done,
      mastPosCount: numOr(e.masturbation?.positive?.count),
      mastNeg: !!e.masturbation?.negative?.done,
      mastNegCount: numOr(e.masturbation?.negative?.count),
      meals: numOr(e.food?.meals),
      foodQuality: numOr(e.food?.quality),
      water: !!e.food?.water,
      yesterdayQuality: numOr(e.yesterdayQuality),
      notes: e.notes,
    }))
    .sort((a, b) => a.date.localeCompare(b.date));
}

function numOr(v) {
  return typeof v === "number" && Number.isFinite(v) ? v : null;
}

/* ============================================================
   Analytics core
   ============================================================ */

function computeMentalScore(d) {
  const parts = [];
  if (d.sleepHours != null) {
    let s;
    if (d.sleepHours >= 7 && d.sleepHours <= 9) s = 10;
    else if (d.sleepHours < 7) s = Math.max(1, 10 - (7 - d.sleepHours) * 2);
    else s = Math.max(1, 10 - (d.sleepHours - 9) * 1.5);
    parts.push({ w: 0.2, v: s });
  }
  if (d.sleepQuality != null) parts.push({ w: 0.15, v: d.sleepQuality });
  if (d.mood != null) parts.push({ w: 0.25, v: d.mood });
  if (d.stress != null) parts.push({ w: 0.25, v: 11 - d.stress });
  if (d.energy != null) parts.push({ w: 0.15, v: d.energy });

  if (!parts.length) return null;
  const tw = parts.reduce((a, p) => a + p.w, 0);
  const s = parts.reduce((a, p) => a + p.w * p.v, 0) / tw;
  return Math.round(s * 10) / 10;
}

function stateLabel(score) {
  if (score == null) return { text: "—", tone: "muted" };
  if (score >= 8.5) return { text: "پایدار و پرانرژی", tone: "good" };
  if (score >= 7)   return { text: "خوب", tone: "good" };
  if (score >= 5.5) return { text: "متوسط", tone: "mid" };
  if (score >= 4)   return { text: "ضعیف — نیاز به توجه", tone: "warn" };
  return { text: "هشدار — نیاز به استراحت", tone: "bad" };
}

function stateHint(score) {
  if (score == null) return "داده‌ی کافی برای تحلیل نیست.";
  if (score >= 8.5) return "خواب، خلق و استرس در محدوده‌ی سالم است. روند فعلی را حفظ کن.";
  if (score >= 7)   return "وضعیت خوب است، ولی جا برای بهبود وجود دارد (کیفیت خواب یا کاهش استرس).";
  if (score >= 5.5) return "روزها متوسط‌اند. به خواب و روتین آرام‌سازی بیشتر توجه کن.";
  if (score >= 4)   return "چند سیگنال ضعیف با هم جمع شده‌اند. یک روز سبک‌تر و خواب بیشتر می‌تواند کمک کند.";
  return "سیستم روانی زیر فشار است. یک روز استراحت واقعی، خواب کافی، و قطع فشارهای غیرضروری توصیه می‌شود.";
}

function average(arr, field) {
  const vals = arr.map((e) => e[field]).filter((v) => typeof v === "number");
  if (!vals.length) return null;
  return Math.round((vals.reduce((a, b) => a + b, 0) / vals.length) * 10) / 10;
}

function pearson(pairs) {
  const n = pairs.length;
  if (n < 5) return null;
  const sx = pairs.reduce((a, [x]) => a + x, 0);
  const sy = pairs.reduce((a, [, y]) => a + y, 0);
  const sxy = pairs.reduce((a, [x, y]) => a + x * y, 0);
  const sx2 = pairs.reduce((a, [x]) => a + x * x, 0);
  const sy2 = pairs.reduce((a, [, y]) => a + y * y, 0);
  const num = n * sxy - sx * sy;
  const den = Math.sqrt((n * sx2 - sx * sx) * (n * sy2 - sy * sy));
  if (!den) return null;
  return Math.round((num / den) * 100) / 100;
}

function computeCorrelations(entries) {
  const pairs = (ax, ay) =>
    entries
      .map((d) => [d[ax], d[ay]])
      .filter(([x, y]) => typeof x === "number" && typeof y === "number");

  return [
    { label: "ساعت خواب × خلق",          v: pearson(pairs("sleepHours", "mood")) },
    { label: "ساعت خواب × استرس",        v: pearson(pairs("sleepHours", "stress")) },
    { label: "کیفیت خواب × خلق",          v: pearson(pairs("sleepQuality", "mood")) },
    { label: "ورزش × خلق",               v: pearson(pairs("exerciseMin", "mood")) },
    { label: "کیفیت غذا × خلق",           v: pearson(pairs("foodQuality", "mood")) },
    { label: "اثر روتین × خلق",           v: pearson(pairs("routineEff", "mood")) },
    { label: "خودارضایی منفی × استرس",   v: pearson(pairs("mastNegCount", "stress")) },
    { label: "خودارضایی منفی × خلق",     v: pearson(pairs("mastNegCount", "mood")) },
    { label: "دیروز خوب × خلق امروز",     v: pearson(pairs("yesterdayQuality", "mood")) },
    { label: "انرژی × خلق",               v: pearson(pairs("energy", "mood")) },
  ].filter((r) => r.v != null);
}

function detectWarnings(entries) {
  const out = [];
  if (!entries.length) return out;

  const last = entries.slice(-14);
  const today = entries[entries.length - 1];

  // 1) استرس بالا در ۳ روز اخیر
  const last3 = entries.slice(-3);
  if (last3.length === 3 && last3.every((d) => d.stress != null && d.stress >= 7)) {
    out.push({ text: "۳ روز پیوسته استرس بالا (۷+) — احتمال فرسودگی.", level: "danger" });
  }

  // 2) خواب کم در ۳ روز اخیر
  if (last3.length === 3 && last3.every((d) => d.sleepHours != null && d.sleepHours < 6)) {
    out.push({ text: "۳ روز پیوسته کمتر از ۶ ساعت خواب — کم‌خوابی مزمن.", level: "danger" });
  }

  // 3) خودارضایی منفی زیاد در ۷ روز اخیر
  const negCount7 = entries.slice(-7).filter((d) => d.mastNeg).length;
  if (negCount7 >= 3) {
    out.push({ text: `خودارضایی منفی در ${negCount7} روز از ۷ روز گذشته — نشانه‌ی فشار روانی.`, level: "danger" });
  }

  // 4) خلق پایین ۳ روز پیوسته
  if (last3.length === 3 && last3.every((d) => d.mood != null && d.mood <= 4)) {
    out.push({ text: "۳ روز پیوسته خلق پایین — احتمال افسردگی خفیف.", level: "danger" });
  }

  // 5) ورزش کم در ۷ روز اخیر
  const exercise7 = entries.slice(-7).filter((d) => d.exerciseDone).length;
  if (exercise7 <= 1) {
    out.push({ text: `ورزش فقط ${exercise7} بار در ۷ روز گذشته.`, level: "warn" });
  }

  // 6) روتین آرام‌سازی رها شده
  const routine7 = entries.slice(-7).filter((d) => d.routineDone).length;
  if (routine7 <= 2) {
    out.push({ text: "روتین آرام‌سازی در بیشتر روزهای اخیر انجام نشده.", level: "warn" });
  }

  // 7) تغذیه‌ی ضعیف
  const foodAvg = average(entries.slice(-7), "foodQuality");
  if (foodAvg != null && foodAvg < 5) {
    out.push({ text: `میانگین کیفیت تغذیه در هفته‌ی اخیر ${foodAvg}/۱۰ — پایین.`, level: "warn" });
  }

  // 8) آب ناکافی
  const water7 = entries.slice(-7).filter((d) => d.water).length;
  if (water7 <= 2) {
    out.push({ text: "آب کافی در بیشتر روزهای هفته‌ی اخیر مصرف نشده.", level: "warn" });
  }

  // 9) عدم ثبت چند روز
  if (today) {
    const lastDate = new Date(today.date);
    const gapDays = Math.floor((Date.now() - lastDate.getTime()) / 86400000);
    if (gapDays >= 3) {
      out.push({ text: `${gapDays} روز است چک‌این ثبت نشده.`, level: "warn" });
    }
  }

  return out;
}

/* ============================================================
   Render
   ============================================================ */

function render() {
  if (!doc || !allEntries.length) {
    $("caEmpty").hidden = false;
    $("caContent").hidden = true;
    $("caCount").textContent = "—";
    return;
  }

  const range = Number($("caRangeSelect").value) || 0;
  visibleEntries = range > 0 ? allEntries.slice(-range) : allEntries;

  $("caEmpty").hidden = true;
  $("caContent").hidden = false;
  $("caCount").textContent = `${allEntries.length} روز ثبت‌شده — نمایش ${visibleEntries.length} روز`;

  renderSummary();
  renderState();
  renderWarnings();
  renderSleepChart();
  renderMoodChart();
  renderBehaviors();
  renderCorrelations();
  renderHeatmap();
  renderTable();
}

/* ---------- summary cards ---------- */

function renderSummary() {
  const e = visibleEntries;
  const avgSleep = average(e, "sleepHours");
  const avgMood = average(e, "mood");
  const avgStress = average(e, "stress");
  const avgEnergy = average(e, "energy");
  const avgQuality = average(e, "sleepQuality");

  const cards = [
    { label: "میانگین خواب", value: avgSleep, unit: "ساعت", sub: `کیفیت ${avgQuality ?? "—"}/۱۰` },
    { label: "میانگین خلق", value: avgMood, unit: "/۱۰" },
    { label: "میانگین استرس", value: avgStress, unit: "/۱۰", tone: avgStress >= 6 ? "bad" : avgStress <= 4 ? "good" : null },
    { label: "میانگین انرژی", value: avgEnergy, unit: "/۱۰" },
  ];

  $("caSummary").innerHTML = cards
    .map(
      (c) => `
    <div class="ca-card">
      <div class="ca-card__label">${c.label}</div>
      <div class="ca-card__value" style="${c.tone === "bad" ? "color:var(--ca-bad)" : c.tone === "good" ? "color:var(--ca-good)" : ""}">
        ${c.value ?? "—"}${c.value != null ? `<small>${c.unit}</small>` : ""}
      </div>
      ${c.sub ? `<div class="ca-card__sub">${c.sub}</div>` : ""}
    </div>`
    )
    .join("");
}

/* ---------- mental state gauge ---------- */

function renderState() {
  const scored = visibleEntries.map((d) => ({ ...d, score: computeMentalScore(d) })).filter((d) => d.score != null);
  if (!scored.length) {
    $("caGauge").innerHTML = "";
    $("caStateLabel").textContent = "—";
    $("caStateTrend").textContent = "داده‌ی کافی نیست.";
    $("caStateHint").textContent = "";
    return;
  }

  const recent = scored.slice(-7);
  const prev = scored.slice(-14, -7);
  const cur = recent.reduce((a, d) => a + d.score, 0) / recent.length;
  const prevAvg = prev.length ? prev.reduce((a, d) => a + d.score, 0) / prev.length : null;

  const label = stateLabel(cur);
  $("caStateLabel").textContent = label.text;
  $("caStateLabel").style.color =
    label.tone === "good" ? "var(--ca-good)"
    : label.tone === "bad" || label.tone === "warn" ? "var(--ca-bad)"
    : label.tone === "mid" ? "var(--ca-warn)"
    : "var(--ca-text)";

  let trendText = "داده‌ی مقایسه‌ای کافی نیست.";
  if (prevAvg != null) {
    const diff = Math.round((cur - prevAvg) * 10) / 10;
    const arrow = diff > 0.3 ? "▲" : diff < -0.3 ? "▼" : "◀▶";
    const word = diff > 0.3 ? "بهبود" : diff < -0.3 ? "افت" : "پایدار";
    trendText = `${arrow} ${word} نسبت به هفته‌ی قبل (${diff > 0 ? "+" : ""}${diff})`;
  }
  $("caStateTrend").textContent = trendText;
  $("caStateHint").textContent = stateHint(cur);

  // gauge svg
  const pct = Math.max(0, Math.min(1, (cur - 1) / 9)); // 1..10 → 0..1
  const angle = -90 + pct * 180; // -90 (چپ) تا +90 (راست)

  const color =
    cur >= 7 ? "var(--ca-good)"
    : cur >= 5.5 ? "var(--ca-warn)"
    : "var(--ca-bad)";

  const cx = 110, cy = 100, r = 80;

  $("caGauge").innerHTML = `
    <svg viewBox="0 0 220 130">
      <defs>
        <linearGradient id="gaugeGrad" x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%"   stop-color="hsl(0,70%,50%)" />
          <stop offset="50%"  stop-color="hsl(45,80%,55%)" />
          <stop offset="100%" stop-color="hsl(120,55%,48%)" />
        </linearGradient>
      </defs>
      <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}"
            fill="none" stroke="url(#gaugeGrad)" stroke-width="14"
            stroke-linecap="round" opacity="0.35" />
      <path d="M ${cx - r} ${cy} A ${r} ${r} 0 0 1 ${cx + r} ${cy}"
            fill="none" stroke="url(#gaugeGrad)" stroke-width="14"
            stroke-linecap="round"
            stroke-dasharray="${(pct * Math.PI * r).toFixed(1)} ${(Math.PI * r).toFixed(1)}" />
      <g transform="translate(${cx} ${cy}) rotate(${angle})">
        <line x1="0" y1="0" x2="0" y2="${-(r - 12)}" stroke="${color}" stroke-width="3" stroke-linecap="round" />
        <circle r="5" fill="${color}" />
      </g>
      <text x="${cx}" y="${cy - 12}" text-anchor="middle" font-size="26" font-weight="700" fill="${color}">
        ${cur.toFixed(1)}
      </text>
      <text x="${cx - r}" y="${cy + 22}" text-anchor="middle" font-size="10" fill="var(--ca-muted)">۱</text>
      <text x="${cx + r}" y="${cy + 22}" text-anchor="middle" font-size="10" fill="var(--ca-muted)">۱۰</text>
    </svg>
  `;
}

/* ---------- warnings ---------- */

function renderWarnings() {
  const w = detectWarnings(allEntries);
  if (!w.length) {
    $("caWarningsPanel").hidden = true;
    return;
  }
  $("caWarningsPanel").hidden = false;
  $("caWarnings").innerHTML = w
    .map((x) => `<div class="ca-warn-item ${x.level === "danger" ? "ca-warn-item--danger" : ""}">${x.text}</div>`)
    .join("");
}

/* ---------- sleep chart ---------- */

function renderSleepChart() {
  const data = visibleEntries.map((d) => ({
    date: d.date,
    sleepHours: d.sleepHours,
    sleepQuality: d.sleepQuality,
    wake: hourToNum(d.wakeTime),
  }));

  const series = [
    { key: "sleepHours",   color: "#6ea8ff", label: "خواب (ساعت)", min: 0, max: 12 },
    { key: "sleepQuality", color: "#a78bfa", label: "کیفیت /۱۰",   min: 0, max: 10 },
    { key: "wake",         color: "#f59e0b", label: "بیداری",       min: 0, max: 24 },
  ];

  $("caSleepChart").innerHTML = buildLineChart(data, series, { yMax: 24, yMin: 0 });
}

function hourToNum(t) {
  if (!t || typeof t !== "string") return null;
  const [h, m] = t.split(":").map(Number);
  if (!Number.isFinite(h)) return null;
  return h + m / 60;
}

/* ---------- mood chart ---------- */

function renderMoodChart() {
  const data = visibleEntries.map((d) => ({
    date: d.date,
    mood: d.mood,
    stress: d.stress,
    energy: d.energy,
  }));

  const series = [
    { key: "mood",   color: "#34d399", label: "خلق" },
    { key: "stress", color: "#f87171", label: "استرس" },
    { key: "energy", color: "#fbbf24", label: "انرژی" },
  ];

  $("caMoodChart").innerHTML = buildLineChart(data, series, { yMin: 1, yMax: 10 });
}

/* ---------- line chart builder ---------- */

function buildLineChart(data, series, { yMin = 0, yMax = 10 } = {}) {
  const W = 800, H = 220;
  const padL = 34, padR = 12, padT = 14, padB = 28;
  const innerW = W - padL - padR;
  const innerH = H - padT - padB;
  const n = data.length;
  if (!n) return "";

  const xAt = (i) => (n === 1 ? padL + innerW / 2 : padL + (i / (n - 1)) * innerW);
  const yAt = (v) => padT + innerH - ((v - yMin) / (yMax - yMin)) * innerH;

  // grid
  const yTicks = 5;
  let grid = "";
  for (let i = 0; i <= yTicks; i++) {
    const v = yMin + ((yMax - yMin) * i) / yTicks;
    const y = yAt(v);
    grid += `<line x1="${padL}" y1="${y}" x2="${W - padR}" y2="${y}" stroke="var(--ca-border)" stroke-width="1" opacity="0.5" />`;
    grid += `<text x="${padL - 6}" y="${y + 3}" text-anchor="end" font-size="9" fill="var(--ca-muted)">${Math.round(v)}</text>`;
  }

  // x labels (فقط ۶ تا)
  let xLabels = "";
  const step = Math.max(1, Math.floor(n / 6));
  for (let i = 0; i < n; i += step) {
    const x = xAt(i);
    const d = data[i].date.slice(5); // MM-DD
    xLabels += `<text x="${x}" y="${H - 8}" text-anchor="middle" font-size="9" fill="var(--ca-muted)">${d}</text>`;
  }

  // series
  let lines = "";
  let dots = "";
  for (const s of series) {
    const pts = [];
    data.forEach((d, i) => {
      const v = d[s.key];
      if (typeof v !== "number") return;
      pts.push([xAt(i), yAt(v)]);
    });
    if (!pts.length) continue;
    const poly = pts.map(([x, y]) => `${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
    lines += `<polyline points="${poly}" fill="none" stroke="${s.color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" />`;
    for (const [x, y] of pts) {
      dots += `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="2.4" fill="${s.color}" />`;
    }
  }

  return `
    <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none">
      ${grid}
      ${xLabels}
      ${lines}
      ${dots}
    </svg>
  `;
}

/* ---------- behaviors ---------- */

function renderBehaviors() {
  const e = visibleEntries;
  const n = e.length;
  if (!n) { $("caBehaviors").innerHTML = ""; return; }

  const pct = (count) => Math.round((count / n) * 100);

  const routineCount = e.filter((d) => d.routineDone).length;
  const exerciseCount = e.filter((d) => d.exerciseDone).length;
  const exerciseMinutes = e.reduce((a, d) => a + (d.exerciseMin || 0), 0);
  const mastPosDays = e.filter((d) => d.mastPos).length;
  const mastNegDays = e.filter((d) => d.mastNeg).length;
  const act1Count = e.filter((d) => d.activity1 === true).length;
  const op1Count = e.filter((d) => d.operation1 === true).length;
  const waterCount = e.filter((d) => d.water).length;
  const avgMeals = average(e, "meals");

  const items = [
    { label: "روتین آرام‌سازی", value: routineCount, unit: `/ ${n} روز`, pct: pct(routineCount) },
    { label: "ورزش", value: exerciseCount, unit: `/ ${n} روز`, pct: pct(exerciseCount) },
    { label: "دقایق ورزش (کل)", value: exerciseMinutes, unit: "دقیقه", pct: null },
    { label: "خودارضایی مثبت", value: mastPosDays, unit: `/ ${n} روز`, pct: pct(mastPosDays) },
    { label: "خودارضایی منفی", value: mastNegDays, unit: `/ ${n} روز`, pct: pct(mastNegDays), danger: mastNegDays / n > 0.3 },
    { label: "فعالیت ۱", value: act1Count, unit: `/ ${n} روز`, pct: pct(act1Count) },
    { label: "عملیات د۱", value: op1Count, unit: `/ ${n} روز`, pct: pct(op1Count) },
    { label: "آب کافی", value: waterCount, unit: `/ ${n} روز`, pct: pct(waterCount) },
    { label: "میانگین وعده‌های غذا", value: avgMeals ?? "—", unit: "وعده", pct: null },
  ];

  $("caBehaviors").innerHTML = items
    .map(
      (x) => `
    <div class="ca-behavior">
      <div class="ca-behavior__label">${x.label}</div>
      <div class="ca-behavior__value" ${x.danger ? 'style="color:var(--ca-bad)"' : ""}>
        ${x.value}<small> ${x.unit}</small>
      </div>
      ${
        x.pct != null
          ? `<div class="ca-behavior__bar"><span style="width:${x.pct}%; background:${x.danger ? "var(--ca-bad)" : "var(--ca-accent)"}"></span></div>`
          : ""
      }
    </div>`
    )
    .join("");
}

/* ---------- correlations ---------- */

function renderCorrelations() {
  const corr = computeCorrelations(visibleEntries);
  if (!corr.length) {
    $("caCorr").innerHTML = `<p class="ca-hint">داده‌ی کافی برای محاسبه‌ی همبستگی وجود ندارد (حداقل ۵ روز لازم است).</p>`;
    return;
  }

  // ترتیب: قدرمطلق نزولی
  corr.sort((a, b) => Math.abs(b.v) - Math.abs(a.v));

  $("caCorr").innerHTML = corr
    .map((r) => {
      const v = r.v;
      const pct = Math.abs(v) * 50; // 0..50
      const fillStyle = v >= 0
        ? `left:50%; width:${pct}%; background:var(--ca-good)`
        : `right:50%; width:${pct}%; background:var(--ca-bad)`;
      return `
      <div class="ca-corr-row">
        <div class="ca-corr-row__label">${r.label}</div>
        <div style="display:flex; align-items:center; gap:10px;">
          <div class="ca-corr-row__bar">
            <div class="ca-corr-row__fill" style="${fillStyle}"></div>
          </div>
          <div class="ca-corr-row__val">${v > 0 ? "+" : ""}${v.toFixed(2)}</div>
        </div>
      </div>`;
    })
    .join("");
}

/* ---------- heatmap ---------- */

function renderHeatmap() {
  const scoreByDate = new Map();
  for (const d of allEntries) {
    const s = computeMentalScore(d);
    if (s != null) scoreByDate.set(d.date, s);
  }

  // از قدیمی‌ترین تا جدیدترین
  const days = [];
  const first = allEntries[0].date;
  const last = allEntries[allEntries.length - 1].date;
  const start = new Date(first + "T00:00:00");
  const end = new Date(last + "T00:00:00");
  for (let cur = new Date(start); cur <= end; cur.setDate(cur.getDate() + 1)) {
    const key = cur.toISOString().slice(0, 10);
    days.push(key);
  }

  $("caHeatmap").innerHTML = days
    .map((key) => {
      const s = scoreByDate.get(key);
      const color = s == null ? "var(--ca-panel-2)" : scoreToColor(s);
      const tip = s == null ? `${key} — بدون داده` : `${key} — ${s.toFixed(1)}/۱۰`;
      return `<div class="ca-heat-cell" style="background:${color}" data-tip="${tip}"></div>`;
    })
    .join("");
}

function scoreToColor(s) {
  // 1..10 → hue 0..120
  const t = Math.max(0, Math.min(1, (s - 1) / 9));
  const hue = t * 120;
  return `hsl(${hue}, 65%, 45%)`;
}

/* ---------- table ---------- */

function renderTable() {
  const cols = [
    { key: "date",           label: "تاریخ" },
    { key: "score",          label: "امتیاز روانی" },
    { key: "sleepHours",     label: "خواب (س)" },
    { key: "sleepQuality",   label: "کیفیت خواب" },
    { key: "routineDone",    label: "روتین" },
    { key: "mood",           label: "خلق" },
    { key: "stress",         label: "استرس" },
    { key: "energy",         label: "انرژی" },
    { key: "exerciseMin",    label: "ورزش (دق)" },
    { key: "mastNegCount",   label: "خودارضایی منفی" },
    { key: "mastPosCount",   label: "خودارضایی مثبت" },
    { key: "foodQuality",    label: "کیفیت غذا" },
    { key: "water",          label: "آب" },
    { key: "yesterdayQuality", label: "دیروز" },
  ];

  const rows = [...visibleEntries].reverse(); // جدیدترین بالا

  let html = "<thead><tr>";
  for (const c of cols) html += `<th>${c.label}</th>`;
  html += "</tr></thead><tbody>";

  for (const d of rows) {
    const score = computeMentalScore(d);
    html += "<tr>";
    for (const c of cols) {
      let v = c.key === "score" ? score : d[c.key];
      let cls = "";

      if (v === null || v === undefined || v === "" || v === false && (c.key === "water" || c.key === "routineDone")) {
        if (c.key === "routineDone" || c.key === "water") {
          v = v ? "✓" : "—";
          cls = v === "—" ? "muted" : "ca-cell-good";
        } else {
          v = "—";
          cls = "muted";
        }
      } else if (c.key === "routineDone") {
        v = "✓"; cls = "ca-cell-good";
      } else if (c.key === "water") {
        v = "✓"; cls = "ca-cell-good";
      } else if (c.key === "date") {
        v = formatDate(v); cls = "date";
      } else if (c.key === "score") {
        cls = v >= 7 ? "ca-cell-good" : v <= 4 ? "ca-cell-bad" : "";
        v = v.toFixed(1);
      } else if (c.key === "stress" || c.key === "mastNegCount") {
        if (typeof v === "number" && v >= 6) cls = "ca-cell-bad";
      } else if (c.key === "mood" || c.key === "energy") {
        if (typeof v === "number" && v >= 7) cls = "ca-cell-good";
        if (typeof v === "number" && v <= 3) cls = "ca-cell-bad";
      }

      html += `<td class="${cls}">${v}</td>`;
    }
    html += "</tr>";
  }

  html += "</tbody>";
  $("caTable").innerHTML = html;
}

function formatDate(key) {
  const d = new Date(key + "T00:00:00");
  const fa = new Intl.DateTimeFormat("fa-IR", { month: "short", day: "2-digit" });
  const en = key.slice(5);
  return `${fa.format(d)} (${en})`;
}

/* ============================================================
   Events
   ============================================================ */

function bindEvents() {
  $("caConnectBtn").addEventListener("click", connectFile);

  $("caImportInput").addEventListener("change", async (ev) => {
    const f = ev.target.files?.[0];
    if (f) await importFile(f);
    ev.target.value = "";
  });

  $("caRangeSelect").addEventListener("change", render);

  // theme: هماهنگ با main app
  const savedTheme = localStorage.getItem("study-timer:theme") || "dark";
  document.body.dataset.theme = savedTheme;
}

init();