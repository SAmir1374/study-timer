/* =============================================================
   foodCatalog.js — فهرست خوراکی‌ها برای ثبت تغذیه
   id ها ثابت‌اند (فقط حروف کوچک انگلیسی، عدد و -)؛ برچسب فارسی
   را می‌شود هر وقت خواستی عوض کرد بدون اینکه داده‌ی قبلی خراب شود.
   هر آیتم: [id, برچسب, برچسب‌های اضافه (اختیاری)]
   ============================================================= */

export const MEALS = [
  { id: "breakfast", title: "صبحانه" },
  { id: "lunch", title: "ناهار" },
  { id: "dinner", title: "شام" },
  { id: "snack", title: "میان‌وعده" },
];

const G = (id, title, tags, items) => ({ id, title, tags, items });

export const FOOD_GROUPS = [
  G("stew", "خورشت‌ها", ["stew", "protein"], [
    ["ghormeh-sabzi", "قورمه‌سبزی"],
    ["gheymeh", "قیمه"],
    ["gheymeh-bademjan", "قیمه‌بادمجان"],
    ["fesenjan", "فسنجان"],
    ["karafs", "کرفس"],
    ["bademjan-stew", "خورشت بادمجان"],
    ["bamieh", "بامیه"],
    ["aloo-esfenaj", "آلو اسفناج"],
    ["kadoo-stew", "خورشت کدو"],
    ["loobia-stew", "خورشت لوبیا سبز"],
  ]),

  G("sides", "برنج و نان", ["carb"], [
    ["rice", "برنج (چلو / کته)"],
    ["bread", "نان"],
    ["tahdig", "ته‌دیگ"],
  ]),

  G("rice-dishes", "پلو و غذاهای برنجی", ["carb"], [
    ["adas-polo", "عدس‌پلو"],
    ["loobia-polo", "لوبیاپلو"],
    ["baghali-polo", "باقالی‌پلو"],
    ["zereshk-polo", "زرشک‌پلو با مرغ", ["protein"]],
    ["shevid-polo", "شوید‌پلو"],
    ["estamboli", "استامبولی"],
    ["dampokht", "دمپختک"],
    ["tahchin", "ته‌چین", ["protein"]],
    ["kalam-polo", "کلم‌پلو"],
  ]),

  G("meat", "گوشت، مرغ و ماهی", ["protein"], [
    ["kabab-koobideh", "کباب کوبیده"],
    ["joojeh-kabab", "جوجه‌کباب"],
    ["chicken", "مرغ (پخته / کبابی)"],
    ["fried-chicken", "مرغ سرخ‌کرده", ["fried"]],
    ["fish", "ماهی"],
    ["kotlet", "کتلت", ["fried"]],
    ["koofteh", "کوفته"],
    ["dolmeh", "دلمه"],
    ["sausage", "سوسیس / کالباس", ["processed"]],
  ]),

  G("other-main", "سایر غذاها", [], [
    ["macaroni", "ماکارونی", ["carb"]],
    ["mashed-potato", "پوره سیب‌زمینی", ["carb"]],
    ["kashk-bademjan", "کشک‌بادمجان"],
    ["mirza-ghasemi", "میرزاقاسمی"],
    ["adasi", "عدسی", ["protein"]],
    ["ash", "آش"],
    ["soup", "سوپ"],
    ["haleem", "حلیم"],
    ["abgoosht", "آبگوشت / دیزی", ["protein"]],
    ["kuku-sabzi", "کوکو سبزی", ["egg", "veg"]],
  ]),

  G("eggs", "تخم‌مرغ", ["protein", "egg"], [
    ["egg-boiled", "تخم‌مرغ آب‌پز"],
    ["egg-fried", "تخم‌مرغ سرخ‌کرده / نیمرو", ["fried"]],
    ["omelet", "املت"],
  ]),

  G("salad", "سالاد و سبزی", ["veg"], [
    ["salad-shirazi", "سالاد شیرازی"],
    ["salad-lettuce", "سالاد کاهو"],
    ["salad-seasonal", "سالاد فصل (کلم / هویج)"],
    ["salad-olivieh", "سالاد الویه", ["protein"]],
    ["sabzi-khordan", "سبزی خوردن"],
    ["cucumber", "خیار"],
    ["tomato", "گوجه"],
    ["torshi", "ترشی"],
  ]),

  G("dairy", "لبنیات", ["dairy"], [
    ["yogurt", "ماست"],
    ["mast-khiar", "ماست و خیار"],
    ["cheese", "پنیر"],
    ["milk", "شیر"],
    ["doogh", "دوغ"],
    ["butter", "کره"],
  ]),

  G("breakfast-items", "صبحانه‌ای‌ها", [], [
    ["bread-cheese", "نان و پنیر", ["carb", "dairy"]],
    ["bread-butter-jam", "نان کره‌مربا", ["carb", "sweet"]],
    ["honey", "عسل", ["sweet"]],
    ["halva-ardeh", "حلوا ارده", ["sweet"]],
    ["cereal-milk", "شیر و غلات", ["carb", "dairy"]],
  ]),

  G("fruit", "میوه‌ها", ["fruit"], [
    ["apple", "سیب"],
    ["tangerine", "نارنگی"],
    ["peach", "هلو"],
    ["orange", "پرتقال"],
    ["pear", "گلابی"],
    ["grape", "انگور"],
    ["melon", "خربزه / طالبی"],
    ["watermelon", "هندوانه"],
    ["pomegranate", "انار"],
    ["banana", "موز"],
    ["kiwi", "کیوی"],
    ["plum", "آلو"],
    ["apricot", "زردآلو"],
    ["cherry", "گیلاس"],
    ["fig", "انجیر"],
    ["persimmon", "خرمالو"],
    ["date", "خرما"],
  ]),

  G("nuts-snacks", "خشکبار و تنقلات", [], [
    ["walnut", "گردو", ["nut"]],
    ["almond", "بادام", ["nut"]],
    ["pistachio", "پسته", ["nut"]],
    ["raisin", "کشمش / میوه خشک", ["dried"]],
    ["seeds", "تخمه", ["nut"]],
    ["chips", "چیپس / پفک", ["junk"]],
    ["chocolate", "شکلات", ["sweet"]],
    ["biscuit-sweets", "بیسکویت / شیرینی", ["sweet"]],
    ["ice-cream", "بستنی", ["sweet", "dairy"]],
  ]),

  G("drinks", "نوشیدنی‌ها", [], [
    ["soda", "نوشابه", ["sweet"]],
    ["juice-packaged", "آبمیوه صنعتی", ["sweet"]],
    ["juice-fresh", "آبمیوه طبیعی", ["fruit"]],
  ]),

  G("fastfood", "فست‌فود", ["fastfood"], [
    ["pizza", "پیتزا"],
    ["sandwich", "ساندویچ"],
    ["burger", "همبرگر"],
    ["fries", "سیب‌زمینی سرخ‌کرده", ["fried", "carb"]],
    ["nugget", "ناگت", ["fried"]],
  ]),
];

/* ---------- ایندکس ---------- */

export const FOOD_INDEX = new Map();
for (const g of FOOD_GROUPS) {
  for (const [id, label, extra = []] of g.items) {
    FOOD_INDEX.set(id, { label, group: g.id, tags: [...g.tags, ...extra] });
  }
}

export const foodLabel = (id) => FOOD_INDEX.get(id)?.label ?? null;
export const foodTags = (id) => FOOD_INDEX.get(id)?.tags ?? [];