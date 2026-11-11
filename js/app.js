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
let screen = null; // "welcome" | "trial" | "done" | "exited" (left without saving) | "stopped" (left, answers saved)
let restarting = false; // "Start over" (a new participant on this device): the onboarding, the old state kept until begin()
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
    else if (screen === "stopped") renderStopped();
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

// ---------- Onboarding ----------

// The onboarding's steps; `onboarding` keeps the step and the form while it lasts (not stored).
const STEPS = ["start", "layout", "questions", "tips", "ready"];
const onboarding = { step: 0, name: "", consent: false };
let examples = null; // assets/examples.json: per language, where each part of the example screenshot is

function languageToggle() {
  return el("div", { class: "lang", role: "group", "aria-label": "Language / שפה" },
    ["en", "he"].map((l) => el("button", { type: "button", class: "chip", "aria-pressed": String(lang === l),
      onclick: () => { setLang(l); if (state) { state.lang = l; persist(); } render(); },
      text: l === "en" ? "English" : "עברית" })));
}

/** The example screenshot with numbered outlines on its parts, and the legend. */
function layoutStep() {
  const parts = ["prompts", "left", "right", "questions"];
  const boxes = examples?.[lang]?.boxes || {};
  const figure = el("figure", { class: "example" },
    el("div", { class: "example-frame", dir: "ltr" },
      el("img", { src: `assets/example-${lang}.webp`, alt: t("example_alt") }),
      parts.filter((part) => boxes[part]).map((part, i) => {
        const [x, y, w, h] = boxes[part];
        return el("div", { class: "callout", style: `left:${x}%;top:${y}%;width:${w}%;height:${h}%` },
          el("span", { class: "callout-n", text: String(i + 1) }));
      })));
  return [el("h2", { text: t("layout_title") }), figure,
    el("ol", { class: "legend" }, parts.map((part) => el("li", {}, t(`layout_${part}`))))];
}

function questionsStep() {
  return [el("h2", { text: t("questions_title") }),
    el("div", { class: "cards" }, QUESTIONS.map((q) => el("div", { class: "card" },
      el("b", { text: t(`${q}_short`) }), el("p", { text: t(`${q}_full`) }),
      q === "diversity" ? el("p", { class: "emph", text: t("diversity_note") }) : null))),
    el("p", { class: "note" }, el("span", { class: "key", text: "◀" }), " ", t("questions_left"), " ",
      el("span", { class: "key", text: "▶" }), " ", t("questions_right"), " ", t("questions_tie"))];
}

function tipsStep() {
  return [el("h2", { text: t("tips_title") }),
    el("ul", { class: "tips" }, ["tip_zoom", "tip_landscape", "tip_time", "tip_no_right"].map((k) => el("li", { text: t(k) })))];
}

function renderWelcome() {
  const step = STEPS[onboarding.step];
  const go = (delta) => { onboarding.step = Math.max(0, Math.min(STEPS.length - 1, onboarding.step + delta)); render(); window.scrollTo(0, 0); };
  let body, forward;
  if (step === "start") {
    const name = el("input", { id: "name", type: "text", autocomplete: "name", maxlength: "60", required: true,
      placeholder: t("name_placeholder"), value: onboarding.name });
    const consent = el("input", { id: "consent", type: "checkbox" });
    consent.checked = onboarding.consent;
    forward = el("button", { class: "primary", type: "submit", text: t("continue") });
    const check = () => {
      onboarding.name = name.value.trim();
      onboarding.consent = consent.checked;
      forward.disabled = !(onboarding.name.length >= 2 && onboarding.consent);
    };
    name.addEventListener("input", check);
    consent.addEventListener("change", check);
    check();
    body = [el("h1", { text: t("title") }), el("p", { class: "lead", text: t("start_lead") }),
      el("form", { class: "start-form", onsubmit: (e) => { e.preventDefault(); if (!forward.disabled) go(1); } },
        el("label", { for: "name", text: t("name_label") }), name,
        el("label", { class: "consent" }, consent, el("span", { text: t("consent") })), forward)];
  } else if (step === "ready") {
    body = [el("div", { class: "ready" }, el("h2", { text: t("ready_title") }), el("p", { class: "lead", text: t("ready_lead") }),
      el("button", { class: "primary big", type: "button", onclick: () => begin(onboarding.name), text: t("start") }))];
  } else {
    body = { layout: layoutStep, questions: questionsStep, tips: tipsStep }[step]();
    forward = el("button", { class: "primary", type: "button", onclick: () => go(1), text: t("continue") });
  }
  const nav = el("nav", { class: "steps-nav" },
    onboarding.step > 0 ? el("button", { class: "chip", type: "button", onclick: () => go(-1), text: t("back") }) : el("span"),
    el("div", { class: "dots", "aria-label": t("step_of", { n: onboarding.step + 1, total: STEPS.length }) },
      STEPS.map((_, i) => el("i", { class: i === onboarding.step ? "on" : "" }))),
    step !== "start" && step !== "ready" ? forward : el("span"));
  app.replaceChildren(el("div", { class: `page onboard step-${step}` },
    submitUrl ? null : el("p", { class: "test-mode", text: t("test_mode") }),
    el("header", { class: "onboard-head" }, el("span", { class: "lang-label", text: "Language · שפה" }), languageToggle()),
    el("section", { class: "step-body" }, body),
    nav));
  if (step === "start") app.querySelector("#name").focus({ preventScroll: true });
}

function begin(name) {
  const participant = uuid();
  const plan = makePlan(index, rng(participant));
  // Records of a previous participant on this device not yet acknowledged are sent before the new session's.
  const leftover = restarting && state ? state.pending : [];
  restarting = false;
  state = {
    participant_id: participant, name, lang, gallery_version: index.version, plan, answers: {}, drafts: {},
    pending: [...leftover], round: 0, started_at: new Date().toISOString(),
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
    onExit: confirmExit,
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
      layoutStep(), questionsStep(), tipsStep(),
      el("button", { class: "primary", type: "button", onclick: () => dialog.remove(), text: t("close") })));
  document.body.append(dialog);
}

// ---------- Leaving ----------

function confirmExit() {
  const answered = Object.keys(state.answers).length;
  const dialog = el("div", { class: "help", role: "alertdialog", "aria-modal": "true", "aria-label": t("exit_title") },
    el("div", { class: "help-box confirm", dir: lang === "he" ? "rtl" : "ltr" },
      el("h2", { text: t("exit_title") }),
      el("p", { text: t("exit_body", { n: answered, total: state.plan.length }) }),
      el("div", { class: "confirm-buttons" },
        el("button", { class: "chip", type: "button", onclick: () => dialog.remove(), text: t("exit_cancel") }),
        el("button", { class: "primary", type: "button", onclick: () => { dialog.remove(); stop(); },
          text: t("exit_save") }),
        el("button", { class: "danger", type: "button", onclick: () => { dialog.remove(); withdraw(); },
          text: t("exit_confirm") }))));
  document.body.append(dialog);
  dialog.querySelector(".chip").focus();
}

/** Leaves the study keeping the answers given so far: they are sent (they were being sent all along). */
function stop() {
  state.stopped = true;
  persist();
  sync();
  render();
}

function renderStopped() {
  const answered = Object.keys(state.answers).length;
  const unsent = state.pending.length;
  app.replaceChildren(el("div", { class: "page done" },
    el("header", { class: "welcome-head" }, el("h1", { text: t("thanks") }), languageToggle()),
    el("p", { class: "lead", text: t("answered", { n: answered }) }),
    savedNote(unsent),
    el("div", { class: "confirm-buttons start" },
      el("button", { class: "primary", type: "button", text: t("continue_answering"),
        onclick: () => { delete state.stopped; persist(); render(); } }),
      el("button", { class: "chip", type: "button", text: t("start_over"), onclick: startOver }))));
  if (unsent) setTimeout(sync, 4000);
}

function savedNote(unsent) {
  if (!submitUrl) return el("p", { class: "warn", text: t("test_mode") });
  return el("p", { class: unsent ? "warn" : "ok", text: unsent ? t("unsent") : t("saved") });
}

/** A new participant on this device; records still unsent are carried over to the new session (begin). */
function startOver() {
  restarting = true;
  Object.assign(onboarding, { step: 0, name: "", consent: false });
  render();
}

/**
 * Leaves the study: the answers on this device are deleted and the unsent ones never sent; a withdrawal record tells
 * the analysis to drop the answers that were already sent.
 */
function withdraw() {
  const record = {
    record_id: uuid(), type: "withdraw", participant_id: state.participant_id, answered: Object.keys(state.answers).length,
    lang, gallery_version: state.gallery_version, app_version: APP_VERSION, sent_at: new Date().toISOString(),
  };
  state = { withdrawn: true, participant_id: state.participant_id, lang, gallery_version: state.gallery_version,
    pending: [record] };
  persist();
  sync();
  render();
}

function renderExited() {
  app.replaceChildren(el("div", { class: "page done" },
    el("header", { class: "welcome-head" }, el("h1", { text: t("exited_title") }), languageToggle()),
    el("p", { class: "lead", text: t("exited_body") }),
    el("div", { class: "confirm-buttons start" },
      el("button", { class: "primary", type: "button", text: t("start_over"), onclick: startOver }))));
}

// ---------- Done ----------

function renderDone() {
  const answered = Object.keys(state.answers).length;
  const unsent = state.pending.length;
  const more = el("button", { class: "primary", type: "button", onclick: extend, text: t("more", { n: EXTRA_QUESTIONS }) });
  const left = index.questions.filter((q) => !state.plan.some((p) => p.id === q.id)).length;
  app.replaceChildren(el("div", { class: "page done" },
    el("header", { class: "welcome-head" }, el("h1", { text: t("thanks") }), languageToggle()),
    el("p", { class: "lead", text: t("answered", { n: answered }) }),
    savedNote(unsent),
    left >= EXTRA_QUESTIONS ? el("p", {}, t("more_lead")) : null,
    el("div", { class: "confirm-buttons start" }, left >= EXTRA_QUESTIONS ? more : null,
      el("button", { class: "chip", type: "button", text: t("start_over"), onclick: startOver }))));
  if (unsent && submitUrl) setTimeout(sync, 4000);
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
  if (!state || restarting) screen = "welcome";
  else if (state.withdrawn) screen = "exited";
  else if (state.stopped) screen = "stopped";
  else screen = currentPosition() < 0 ? "done" : "trial";
  updateRotate();
  if (screen === "welcome") renderWelcome();
  else if (screen === "trial") renderTrialScreen();
  else if (screen === "exited") renderExited();
  else if (screen === "stopped") renderStopped();
  else renderDone();
}

let resizeFrame = 0;
window.addEventListener("resize", () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => { updateRotate(); trial?.relayout(); });
});
window.visualViewport?.addEventListener("resize", () => {
  cancelAnimationFrame(resizeFrame);
  resizeFrame = requestAnimationFrame(() => { updateRotate(); trial?.relayout(); });
});
window.addEventListener("online", sync);

async function main() {
  try {
    await loadStrings();
    index = await fetchJson(`${GALLERY}/index.json`);
    examples = await fetchJson("assets/examples.json", 1).catch(() => null);
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
