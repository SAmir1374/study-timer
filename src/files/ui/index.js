/* =============================================================
   ui/index.js — public API of the UI layer
   Presentation only: reads Application State and renders.

   ساختار پوشه (Folder map)
   -------------------------------------------------------------
   ui.js                      shim قدیمی: export * from './ui/index.js'

   ui/
   ├─ index.js                API عمومی UI (re-export همه‌چیز) + bind کردن eventهای کارت‌های برنامه
   ├─ elements.js             شیء `el`: همه‌ی getElementById ها. المان HTML جدید؟ اینجا اضافه کن
   ├─ utils.js                helperهای خالص: escapeHtml، تاریخ (utcMs، saturdayWeekRange،
   │                          formatPersianDate)، برچسب نوع جلسه (typeLabel، kindLabelOf،
   │                          kindShortLabel)، makeL (انتخاب متن fa/en)، getLanguage
   ├─ planData.js             داده‌ی برنامه هفتگی و محاسبات (بدون DOM):
   │                          هدف روز/هفته، دقیقه‌ی واقعی، computeDaySummary،
   │                          computeSubjectCompletion، buildWeeklyPlanDisplayWeeks،
   │                          getEffectiveDailyGoalMinutes، formatAnalysisSummary
   ├─ formUtils.js            readOptionalNumber: خواندن و اعتبارسنجی inputهای عددی
   ├─ toast.js                showToast
   ├─ appearance.js           applyTheme، applyReducedMotion، toggleFullscreen
   ├─ language.js             setLanguage، applyLanguageAttributes، renderTranslations
   │
   ├─ render/                 رندر صفحه‌ی اصلی (Render.all() همه را صدا می‌زند)
   │  ├─ index.js             ترکیب همه در شیء `Render` (ترتیب اجرای all() اینجاست)
   │  ├─ textCache.js         setText: از لمس بی‌دلیل DOM جلوگیری می‌کند
   │  ├─ timer.js             ساعت زنده، متن وضعیت، حلقه‌ی تایمر، دکمه‌ها
   │  ├─ stats.js             آمار امروز + پیشرفت هدف روزانه
   │  ├─ lists.js             تفکیک درس‌های امروز، timeline، history
   │  ├─ pickers.js           preset مدت، chip درس‌ها، سوییچ نوع (مطالعه/تمرین/تست)
   │  ├─ exam.js              کارت شمارش معکوس آزمون
   │  ├─ saveStatus.js        نشانگر ذخیره (فایل اصلی + فایل برنامه هفتگی)
   │  ├─ weeklyPlan.js        کارت هفته‌ها و روزها + هدر هفته + کلیک روی کارت روز
   │  └─ daysStrip.js         نقشه‌ی حرارتی موفقیت (۷ ردیف × N هفته)
   │
   ├─ dayModal/               مودال جزئیات روز (۳ تب)
   │  ├─ index.js             ساخت/باز/بستن مودال، سوییچ تب، کیبورد، refreshDayModal
   │  ├─ markup.js            اسکلت HTML ثابت مودال
   │  ├─ shared.js            dayStat، getDayBlocks، فرمت تاریخ/دقیقه، DAY_HOUR_PX
   │  ├─ actualTab.js         تب «انجام‌شده»: timeline ۲۴ساعته‌ی جلسه‌های ثبت‌شده
   │  ├─ planTab.js           تب «برنامه»: جلسات برنامه‌ریزی‌شده + هفته‌ی برنامه
   │  └─ analysisTab.js       تب «تحلیل»: KPI، نمودار درس‌ها، donut، ساعتی، نتایج تست
   │
   └─ modals/                 مودال‌های فرم‌محور
      ├─ index.js             isAnyModalOpen
      ├─ analysisModal.js     مودال بعد از جلسه (انتخاب مبحث + متریک‌های تحلیل)
      ├─ checkinModal.js      مودال چک‌این روزانه (خواب، ورزش، ...)
      └─ settings.js          تنظیمات: فرم، اعتبارسنجی برنامه‌ی آزمون، لیست درس‌ها

   کجا برم؟ (Where to change what)
   -------------------------------------------------------------
   متن/ترجمه‌ی ثابت        → state.js (tr()) یا همان فایل رندر مربوطه (L('فارسی','English'))
   ظاهر کارت روز هفتگی     → render/weeklyPlan.js  (buildDayElement)
   هدر هر هفته             → render/weeklyPlan.js  (buildWeekSection)
   رنگ نقشه‌ی حرارتی       → render/daysStrip.js   (ratioToHsl)
   هدف روزانه              → planData.js           (getEffectiveDailyGoalMinutes)
   محاسبه‌ی دقیقه‌ی واقعی   → planData.js           (activeMinutes)
   فیلدهای فرم چک‌این       → modals/checkinModal.js + elements.js
   فیلدهای تنظیمات          → modals/settings.js + elements.js
   نمودارهای تب تحلیل       → dayModal/analysisTab.js
   اضافه‌کردن بخش رندر جدید  → فایل در render/ + اضافه به render/index.js (Render و all())
   ============================================================= */

/* =============================================================
   ui/index.js — public API of the UI layer.
   Presentation only: reads Application State and renders.
   ============================================================= */

import { bindWeeklyPlanEvents } from "./render/weeklyPlan.js";

export { el } from "./elements.js";
export { Render } from "./render/index.js";

export { renderTranslations, applyLanguageAttributes, setLanguage } from "./language.js";
export { applyTheme, applyReducedMotion, toggleFullscreen } from "./appearance.js";
export { showToast } from "./toast.js";

export { isAnyModalOpen } from "./modals/index.js";
export { openDayModal, closeDayModal } from "./dayModal/index.js";
export {
  openAnalysisModal,
  closeAnalysisModal,
  getAnalysisModalSessionId,
  getAnalysisModalSessionType,
  readAnalysisForm,
} from "./modals/analysisModal.js";
export {
  openCheckinModal,
  closeCheckinModal,
  getCheckinDateKey,
  readCheckinForm,
} from "./modals/checkinModal.js";
export {
  populateSettingsForm,
  renderSubjectManageList,
  openSettings,
  closeSettings,
  validatePlan,
  applySettingsFromForm,
} from "./modals/settings.js";

// Day cards are re-created on every render, so events are delegated.
bindWeeklyPlanEvents();
