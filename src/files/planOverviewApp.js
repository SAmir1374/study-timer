/* =============================================================
   planOverviewApp.js
   Entry point for plan-overview.html.
   This page is READ-ONLY and works with the Schema v4
   phased-master-study-plan.
   Data flow:
     WeeklyPlanStore
          ↓
     Master Plan
          ↓
     buildPlanAnalytics()
          ↓
     renderDashboard()
   No study-data.json.
   No writes.
   No session/actual-study calculations.
   ============================================================= */
import { WeeklyPlanStore } from "./weeklyPlanStore.js";
import { buildPlanAnalytics } from "./planAnalytics.js";
import { el, renderDashboard, applyTheme, showToast } from "./planOverviewUi.js";
const THEME_KEY = "study-timer:plan-overview-theme";
const MESSAGES = {
  toastFileCreated: "فایل برنامه هفتگی ایجاد و متصل شد",
  toastFileLoaded: "فایل برنامه هفتگی بارگذاری شد",
  toastImported: "داده‌ها وارد شدند",
  toastExported: "فایل خروجی ساخته شد",
  toastInvalid: "فایل برنامه هفتگی نامعتبر است",
  toastSaveFailed: "ذخیره فایل ناموفق بود",
  toastNoFileApi: "این مرورگر دسترسی مستقیم به فایل را پشتیبانی نمی‌کند.",
  toastNoFile: "ابتدا یک فایل متصل کنید",
  toastNoPermission: "دسترسی به فایل داده نشد",
  toastReadFailed: "خواندن فایل ناموفق بود",
  toastSaved: "ذخیره شد",
  toastCleared: "تمام داده‌ها پاک شد",
};
/* ------------------------------------------------------------
   Analytics
   ------------------------------------------------------------ */
function render() {
  const masterPlan = WeeklyPlanStore.getDoc();
  const analytics = buildPlanAnalytics(masterPlan);
  renderDashboard(analytics);
}
/* ------------------------------------------------------------
   Store messages
   ------------------------------------------------------------ */
WeeklyPlanStore.hooks.onMessage = (key, tone, detail) => {
  const text = MESSAGES[key] || key;
  showToast(detail ? `${text} — ${detail}` : text, tone);
};
WeeklyPlanStore.hooks.onLoaded = () => {
  render();
};
/* ------------------------------------------------------------
   Theme
   ------------------------------------------------------------ */
function initTheme() {
  let theme = "dark";
  try {
    theme = localStorage.getItem(THEME_KEY) || "dark";
  } catch {
    // Ignore localStorage errors.
  }
  applyTheme(theme);
}
el.themeToggle?.addEventListener("click", () => {
  const current = document.body.getAttribute("data-theme") === "dark" ? "light" : "dark";
  applyTheme(current);
  try {
    localStorage.setItem(THEME_KEY, current);
  } catch {
    // Ignore localStorage errors.
  }
});
/* ------------------------------------------------------------
   Connect panel
   ------------------------------------------------------------ */
el.connectWeeklyPlanBtn?.addEventListener("click", async () => {
  try {
    const connected = await WeeklyPlanStore.connect();
    if (connected) {
      render();
    }
  } catch (err) {
    console.error("Weekly plan connect failed:", err);
    showToast(err instanceof Error ? err.message : String(err), "error");
  }
});
el.openWeeklyPlanBtn?.addEventListener("click", async () => {
  try {
    const opened = await WeeklyPlanStore.openFile();
    if (opened) {
      render();
    }
  } catch (err) {
    console.error("Weekly plan open failed:", err);
    showToast(err instanceof Error ? err.message : String(err), "error");
  }
});
/* ------------------------------------------------------------
   Init
   ------------------------------------------------------------ */
async function init() {
  initTheme();
  try {
    await WeeklyPlanStore.init();
  } catch (err) {
    console.error("Weekly plan initialization failed:", err);
    showToast(err instanceof Error ? err.message : String(err), "error");
  }
  render();
}
void init();
