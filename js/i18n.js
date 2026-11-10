// UI strings in English and Hebrew (i18n/<lang>.json); prompts come translated in each question.json.
const strings = {};
export let lang = "en";

export async function loadStrings() {
  const [en, he] = await Promise.all(["en", "he"].map((l) => fetch(`i18n/${l}.json`).then((r) => r.json())));
  Object.assign(strings, { en, he });
}

export function setLang(next) {
  lang = next === "he" ? "he" : "en";
  document.documentElement.lang = lang;
  document.documentElement.dir = lang === "he" ? "rtl" : "ltr";
  document.title = t("title");
}

/** The string `key` in the current language, with {name} placeholders filled from `vars`. */
export function t(key, vars = {}) {
  const text = strings[lang]?.[key] ?? strings.en?.[key] ?? key;
  return text.replace(/\{(\w+)\}/g, (_, name) => String(vars[name] ?? ""));
}
