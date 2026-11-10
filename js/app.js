// The study's flow: welcome, the questions, done. The session plan and the answers live in localStorage, so a reload
// resumes where the participant left off.
import { APP_VERSION, EXTRA_QUESTIONS, GALLERY } from "./config.js";
import { lang, loadStrings, setLang, t } from "./i18n.js";
import { clear, load, makePlan, rng, save, uuid } from "./state.js";
import { enqueue, flush, submitUrl } from "./submit.js";
import { QUESTIONS, preload, renderTrial } from "./trial.js";

const app = document.getElementById("app");
const rotate = document.getElementById("rotate");
let index = null;
let state = null;
let screen = null; // "welcome" | "trial" | "done"
let trial = null;
let rotateDismissed = false;
const cache = new Map();

function el(tag, attrs = {}, ...children) {
  const node = document.createElement(tag);
  for (const [key, value] of Object.entries(attrs)) {
    if (key === "class") node.className = value;
    else if (key === "text") node.textContent = value;
    else if (key.startsWith("on")) node.addEventListener(key.slice(2), value);
    else if (value !== false && value != null) node.setAttribute(key, value === true ? "" : value);
  }
  for (const child of children.flat()) if (child != null) node.append(child);
  return node;
}

async function fetchJson(url, tries = 3) {
  for (let attempt = 1; ; attempt++) {
    try {
      const response = await fetch(url, { cache: "no-cache" });
      if (!response.ok) throw new Error(`${response.status} ${url}`);
      return await response.json();
    } catch (error) {
      if (attempt >= tries) throw error;
      await new Promise((r) => setTimeout(r, 800 * attempt));
    }
  }
}

function question(id) {
  if (!cache.has(id)) {
    const promise = fetchJson(`${GALLERY}/${id}/question.json`);
    promise.catch(() => cache.delete(id));
    cache.set(id, promise);
  }
  return cache.get(id);
}

function viewport() {
  return `${window.innerWidth}x${window.innerHeight}`;
}

function persist() {
  save(state);
}

function sync() {
  flush(state, persist).then(() => {
    persist();
    if (screen === "done") renderDone();
  });
}

// ---------- Rotate overlay ----------

function portraitPhone() {
  return window.matchMedia("(orientation: portrait) and (max-width: 900px)").matches;
}

function updateRotate() {
  const show = portraitPhone() && !(screen !== "trial" && rotateDismissed);
  rotate.hidden = !show;
  document.getElementById("rotate-text").textContent = t("rotate");
  const dismiss = document.getElementById("rotate-dismiss");
  dismiss.hidden = screen === "trial";
  dismiss.textContent = t("rotate_dismiss");
}

document.getElementById("rotate-dismiss").addEventListener("click", () => {
  rotateDismissed = true;
  updateRotate();
});

// ---------- Welcome ----------

function instructions() {
  return el("div", { class: "instructions" },
    el("ol", {},
      el("li", { text: t("inst_pairs") }),
      el("li", {}, t("inst_highlight_a"), " ", el("span", { class: "hl hl-0", text: t("inst_highlight_word") }), " ",
        t("inst_highlight_b")),
      el("li", {}, t("inst_answer"),
        el("ul", {}, QUESTIONS.map((q) => el("li", {}, el("b", { text: `${t(`${q}_short`)}: ` }), t(`${q}_full`))))),
      el("li", { text: t("inst_zoom") }),
      el("li", { text: t("inst_time") }),
      el("li", { text: t("inst_landscape") })),
    el("figure", { class: "example" },
      el("img", { src: `assets/example-${lang}.webp`, alt: t("example_alt"), onerror: (e) => e.target.parentNode.remove() }),
      el("figcaption", { text: t("example_caption") })));
}

function languageToggle() {
  return el("div", { class: "lang", role: "group", "aria-label": "Language / שפה" },
    ["en", "he"].map((l) => el("button", { type: "button", class: "chip", "aria-pressed": String(lang === l),
      onclick: () => { setLang(l); if (state) { state.lang = l; persist(); } render(); },
      text: l === "en" ? "English" : "עברית" })));
}

function renderWelcome() {
  const name = el("input", { id: "name", type: "text", autocomplete: "name", maxlength: "60", required: true,
    placeholder: t("name_placeholder") });
  const consent = el("input", { id: "consent", type: "checkbox" });
  const start = el("button", { class: "primary", type: "submit", disabled: true, text: t("start") });
  const check = () => { start.disabled = !(name.value.trim().length >= 2 && consent.checked); };
  name.addEventListener("input", check);
  consent.addEventListener("change", check);
  const form = el("form", { class: "start-form", onsubmit: (e) => { e.preventDefault(); if (!start.disabled) begin(name.value.trim()); } },
    el("label", { for: "name", text: t("name_label") }), name,
    el("label", { class: "consent" }, consent, el("span", { text: t("consent") })),
    start);
  app.replaceChildren(el("div", { class: "page welcome" },
    submitUrl ? null : el("p", { class: "test-mode", text: t("test_mode") }),
    el("header", { class: "welcome-head" }, el("h1", { text: t("title") }), languageToggle()),
    el("p", { class: "lead", text: t("intro") }),
    instructions(),
    form));
}

function begin(name) {
  const participant = uuid();
  const plan = makePlan(index, rng(participant));
  state = {
    participant_id: participant, name, lang, gallery_version: index.version, plan, answers: {}, drafts: {},
    pending: [], round: 0, started_at: new Date().toISOString(),
  };
  enqueue(state, {
    record_id: uuid(), type: "session", participant_id: participant, name, lang, started_at: state.started_at,
    user_agent: navigator.userAgent, viewport: viewport(), device_pixel_ratio: window.devicePixelRatio,
    touch: "ontouchstart" in window || navigator.maxTouchPoints > 0, gallery_version: index.version,
    app_version: APP_VERSION,
  });
  persist();
  sync();
  render();
}

// ---------- Questions ----------

function currentPosition() {
  return state.plan.findIndex((item) => !state.answers[item.id]);
}

async function renderTrialScreen() {
  const position = currentPosition();
  if (position < 0) {
    screen = "done";
    return renderDone();
  }
  const item = state.plan[position];
  app.replaceChildren(el("div", { class: "page loading", text: t("loading") }));
  let data;
  try {
    data = await question(item.id);
  } catch {
    app.replaceChildren(el("div", { class: "page loading" }, el("p", { text: t("connection") }),
      el("button", { class: "primary", type: "button", onclick: render, text: t("retry") })));
    return;
  }
  if (screen !== "trial" || currentPosition() !== position) return;
  trial?.destroy();
  trial = renderTrial(app, {
    question: data, item, position: position + 1, total: state.plan.length, saved: state.drafts[item.id],
    onAnswer: (answers) => { state.drafts[item.id] = answers; persist(); },
    onLang: () => { setLang(lang === "he" ? "en" : "he"); state.lang = lang; persist(); render(); },
    onHelp: showHelp,
    onNext: (answers, timing) => answer(item, data, position, answers, timing),
  });
  // The next question's files, while this one is answered.
  const following = state.plan[position + 1];
  if (following) question(following.id).then(preload).catch(() => {});
}

function answer(item, data, position, answers, timing) {
  const mapped = (value) => (value === "tie" ? "tie" : value === item.oursSide ? "ours" : "other");
  const record = {
    record_id: uuid(), type: "response", participant_id: state.participant_id, trial_id: item.id,
    position: position + 1, library: data.source.library, baseline: data.baseline, catch: item.catch,
    ours_side: item.oursSide,
    ...Object.fromEntries(QUESTIONS.map((q) => [`answer_${q}`, answers[q]])),
    ...Object.fromEntries(QUESTIONS.map((q) => [`pref_${q}`, mapped(answers[q])])),
    ...timing, lang, viewport: viewport(), gallery_version: state.gallery_version, app_version: APP_VERSION,
    sent_at: new Date().toISOString(),
  };
  state.answers[item.id] = { ...answers };
  delete state.drafts[item.id];
  enqueue(state, record);
  persist();
  sync();
  render();
}

function showHelp() {
  const dialog = el("div", { class: "help", role: "dialog", "aria-modal": "true", "aria-label": t("help") },
    el("div", { class: "help-box", dir: lang === "he" ? "rtl" : "ltr" },
      el("h2", { text: t("help") }), instructions(),
      el("button", { class: "primary", type: "button", onclick: () => dialog.remove(), text: t("close") })));
  document.body.append(dialog);
}

// ---------- Done ----------

function renderDone() {
  const answered = Object.keys(state.answers).length;
  const unsent = submitUrl ? state.pending.length : 0;
  const more = el("button", { class: "primary", type: "button", onclick: extend, text: t("more", { n: EXTRA_QUESTIONS }) });
  const left = index.questions.filter((q) => !state.plan.some((p) => p.id === q.id)).length;
  app.replaceChildren(el("div", { class: "page done" },
    el("header", { class: "welcome-head" }, el("h1", { text: t("thanks") }), languageToggle()),
    el("p", { class: "lead", text: t("answered", { n: answered }) }),
    el("p", { class: unsent ? "warn" : "ok", text: unsent ? t("unsent") : t("saved") }),
    left >= EXTRA_QUESTIONS ? el("p", {}, t("more_lead")) : null,
    left >= EXTRA_QUESTIONS ? more : null));
  if (unsent) setTimeout(sync, 4000);
}

function extend() {
  state.round += 1;
  const extra = makePlan(index, rng(`${state.participant_id}:${state.round}`),
    { main: EXTRA_QUESTIONS, catches: 0, seen: state.plan });
  state.plan.push(...extra);
  persist();
  render();
}

// ---------- Rendering ----------

function render() {
  trial?.destroy();
  trial = null;
  if (!state) screen = "welcome";
  else screen = currentPosition() < 0 ? "done" : "trial";
  updateRotate();
  if (screen === "welcome") renderWelcome();
  else if (screen === "trial") renderTrialScreen();
  else renderDone();
}

let resizeFrame = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => { updateRotate(); trial?.relayout(); });
});
window.addEventListener("online", sync);

async function main() {
  try {
    await loadStrings();
    index = await fetchJson(`${GALLERY}/index.json`);
  } catch {
    app.replaceChildren(el("div", { class: "page loading", text: "Could not load the study. Please reload the page." }));
    return;
  }
  state = load();
  if (new URLSearchParams(location.search).has("reset")) {
    clear();
    state = null;
  }
  // A session from another gallery version cannot continue: its questions may no longer exist.
  if (state && state.gallery_version !== index.version) {
    if (state.pending?.length) sync();
    state = null;
  }
  setLang(state?.lang || ((navigator.language || "").toLowerCase().startsWith("he") ? "he" : "en"));
  render();
  if (state) sync();
}

main();
