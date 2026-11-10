// One question: the two prompts, the two sides' images, the three questions, and the zoom view.
import { GALLERY, MIN_VIEW_MS } from "./config.js";
import { lang, t } from "./i18n.js";

export const QUESTIONS = ["quality", "alignment", "diversity"];
const ANSWERS = ["left", "tie", "right"];

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

/** A tagged prompt ("... <r1>red glasses</r1> ...") as text and spans; the changed regions' spans are highlighted. */
export function promptNodes(text, changed) {
  const nodes = [];
  const pattern = /<r(\d+)>([\s\S]*?)<\/r\1>/g;
  let last = 0;
  for (const match of text.matchAll(pattern)) {
    if (match.index > last) nodes.push(document.createTextNode(text.slice(last, match.index)));
    const region = Number(match[1]);
    nodes.push(el("span", { class: changed.includes(region) ? `hl hl-${changed.indexOf(region)}` : "", text: match[2] }));
    last = match.index + match[0].length;
  }
  if (last < text.length) nodes.push(document.createTextNode(text.slice(last)));
  return nodes;
}

function badge(i) {
  return el("span", { class: "badge", "aria-hidden": "true", text: String(i + 1) });
}

function imageUrl(question, imageId, size) {
  return `${GALLERY}/${question.id}/${size}/${imageId}.webp`;
}

/** The images of a question per physical side: {left: [id, id], right: [id, id]}. */
function sides(question, oursSide) {
  const { ours, other } = question.images;
  return oursSide === "left" ? { left: ours, right: other } : { left: other, right: ours };
}

export function prompts(question) {
  return question.prompts[lang] || question.prompts.en;
}

/** Preloads a question's small images. */
export function preload(question) {
  for (const id of [...question.images.ours, ...question.images.other]) {
    const img = new Image();
    img.src = imageUrl(question, id, "s");
  }
}

/**
 * Renders a question into `root`. `ctx`: {question, item, position, total, saved (answers to restore), onAnswer,
 * onNext(answers, timing), onLang, onHelp}. Returns {destroy, relayout}.
 */
export function renderTrial(root, ctx) {
  const { question, item } = ctx;
  const images = sides(question, item.oursSide);
  const answers = { ...(ctx.saved || {}) };
  const shownAt = performance.now();
  let loadedAt = null;
  let zooms = 0;
  let active = 0;
  let timer = null;

  const progress = el("div", { class: "bar", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(ctx.total),
    "aria-valuenow": String(ctx.position - 1) }, el("i", { style: `width:${(100 * (ctx.position - 1)) / ctx.total}%` }));
  // A second Next in the top bar, shown instead of the other one on very short screens (CSS).
  const nextTop = el("button", { class: "next-top primary", type: "button", disabled: true, onclick: () => next() },
    t("next"));
  const top = el("header", { class: "topbar" },
    el("span", { class: "count", dir: "ltr", text: `${ctx.position} / ${ctx.total}` }),
    progress, nextTop,
    el("button", { class: "chip", type: "button", onclick: ctx.onLang, text: lang === "he" ? "English" : "עברית" }),
    el("button", { class: "chip round", type: "button", "aria-label": t("help"), onclick: ctx.onHelp, text: "?" }));

  const texts = prompts(question);
  const strip = el("section", { class: "prompts", "aria-label": t("prompts") },
    texts.map((text, i) => el("p", { class: "prompt", dir: lang === "he" ? "rtl" : "ltr" }, badge(i),
      el("span", {}, promptNodes(text, question.changed)))));

  const pending = [];
  const side = (name) => el("div", { class: `side ${name}` }, images[name].map((id, i) => {
    const img = el("img", { src: imageUrl(question, id, "s"), alt: t("image_alt", { n: i + 1 }), draggable: "false",
      decoding: "async" });
    pending.push(new Promise((resolve) => {
      if (img.complete && img.naturalWidth) resolve();
      else { img.addEventListener("load", resolve, { once: true }); img.addEventListener("error", resolve, { once: true }); }
    }));
    return el("button", { class: "shot", type: "button", "aria-label": t("zoom_image", { n: i + 1 }),
      onclick: () => openZoom(i) }, img, badge(i));
  }));

  const nextButton = el("button", { class: "next primary", type: "button", disabled: true, onclick: () => next() },
    t("next"));
  const groups = QUESTIONS.map((key, q) => {
    const info = el("div", { class: "info-pop", hidden: true, dir: lang === "he" ? "rtl" : "ltr", text: t(`${key}_full`) });
    const buttons = ANSWERS.map((value) => el("button", {
      class: "seg-btn", type: "button", "data-value": value, "aria-pressed": String(answers[key] === value),
      "aria-label": t(`answer_${value}`), onclick: () => choose(q, value),
      text: value === "left" ? "◀" : value === "right" ? "▶" : t("tie"),
    }));
    const group = el("div", { class: "q", role: "group", "aria-label": t(`${key}_short`) },
      el("div", { class: "q-label", dir: lang === "he" ? "rtl" : "ltr" },
        el("span", { text: t(`${key}_short`) }),
        el("button", { class: "info", type: "button", "aria-label": t("what_is", { q: t(`${key}_short`) }),
          onclick: (event) => { event.stopPropagation(); info.hidden = !info.hidden; }, text: "?" })),
      info,
      el("div", { class: "seg", dir: "ltr" }, buttons));
    return { group, buttons, info };
  });
  const center = el("div", { class: "questions" }, groups.map((g) => g.group), nextButton);
  const compare = el("section", { class: "compare", dir: "ltr" }, side("left"), center, side("right"));
  const view = el("div", { class: "trial" }, top, strip, compare);
  root.replaceChildren(view);

  const closeInfos = () => groups.forEach((g) => { g.info.hidden = true; });
  document.addEventListener("click", closeInfos);

  function choose(q, value) {
    active = q;
    answers[QUESTIONS[q]] = value;
    groups[q].buttons.forEach((b) => b.setAttribute("aria-pressed", String(b.dataset.value === value)));
    ctx.onAnswer?.(answers);
    update();
  }

  function ready() {
    return QUESTIONS.every((k) => answers[k]) && loadedAt !== null && performance.now() - loadedAt >= MIN_VIEW_MS;
  }

  function update() {
    nextButton.disabled = nextTop.disabled = !ready();
    clearTimeout(timer);
    if (!ready() && loadedAt !== null && QUESTIONS.every((k) => answers[k])) {
      timer = setTimeout(update, MIN_VIEW_MS - (performance.now() - loadedAt) + 20);
    }
  }

  Promise.all(pending).then(() => {
    loadedAt = performance.now();
    update();
  });

  let arrangement = "row";
  function relayout() {
    // The width inside a scrollbar, so the layout never scrolls sideways.
    const W = document.documentElement.clientWidth - 4, H = window.innerHeight;
    const phone = W < 900;
    const C = phone ? 168 : 248, g = phone ? 6 : 12;
    const T = top.offsetHeight, P = strip.offsetHeight;
    const free = H - T - P - (phone ? 10 : 24);
    const stacked = Math.min((W - C) / 2 - 2 * g, free / 2 - 2 * g);
    const row = Math.min(((W - C) / 2 - 3 * g) / 2, free - 2 * g);
    arrangement = stacked > row ? "stacked" : "row";
    const size = Math.max(64, Math.floor(Math.max(stacked, row)));
    compare.dataset.arrangement = arrangement;
    compare.style.setProperty("--img", `${size}px`);
    compare.style.setProperty("--center", `${C}px`);
    compare.style.setProperty("--gap", `${g}px`);
  }
  relayout();

  function next() {
    if (!ready()) return;
    ctx.onNext({ ...answers }, {
      t_images_loaded: Math.round(loadedAt - shownAt),
      t_next: Math.round(performance.now() - shownAt),
      zoom_count: zooms,
      arrangement,
    });
  }

  // The zoom view: both sides' images for one prompt, large, with the prompt above them.
  let zoom = null;
  function openZoom(index) {
    zooms++;
    let current = index;
    const promptLine = el("p", { class: "prompt", dir: lang === "he" ? "rtl" : "ltr" });
    const pics = ["left", "right"].map(() => el("img", { alt: "", draggable: "false" }));
    const tabs = [0, 1].map((i) => el("button", { class: "chip", type: "button", "aria-pressed": "false",
      onclick: () => show(i) }, badge(i), " ", t("prompt_n", { n: i + 1 })));
    const close = el("button", { class: "chip round close", type: "button", "aria-label": t("close"),
      onclick: closeZoom, text: "✕" });
    const show = (i) => {
      current = i;
      promptLine.replaceChildren(badge(i), el("span", {}, promptNodes(texts[i], question.changed)));
      pics[0].src = imageUrl(question, images.left[i], "l");
      pics[1].src = imageUrl(question, images.right[i], "l");
      pics[0].alt = t("zoom_left", { n: i + 1 });
      pics[1].alt = t("zoom_right", { n: i + 1 });
      tabs.forEach((tab, j) => tab.setAttribute("aria-pressed", String(i === j)));
    };
    let touchX = null;
    zoom = el("div", { class: "zoom", role: "dialog", "aria-modal": "true", "aria-label": t("zoom_title"),
      ontouchstart: (e) => { touchX = e.touches[0].clientX; },
      ontouchend: (e) => {
        if (touchX === null) return;
        const dx = e.changedTouches[0].clientX - touchX;
        if (Math.abs(dx) > 50) show(1 - current);
        touchX = null;
      } },
      el("div", { class: "zoom-bar" }, tabs, el("span", { class: "spacer" }), close),
      promptLine,
      el("div", { class: "zoom-pics", dir: "ltr" }, pics.map((p) => el("div", { class: "zoom-pic" }, p))));
    document.body.append(zoom);
    show(index);
    close.focus();
  }
  function closeZoom() {
    zoom?.remove();
    zoom = null;
  }

  function onKey(event) {
    if (event.target.closest?.("input, textarea")) return;
    if (zoom) {
      if (event.key === "Escape") closeZoom();
      return;
    }
    if (["1", "2", "3"].includes(event.key)) {
      active = Number(event.key) - 1;
      groups[active].buttons[1].focus();
    } else if (event.key === "ArrowLeft") choose(active, "left");
    else if (event.key === "ArrowRight") choose(active, "right");
    else if (event.key === "ArrowDown") choose(active, "tie");
    else if (event.key === "Enter" && !event.target.closest?.("button")) next();
    else if (event.key === "z") openZoom(0);
    else return;
    event.preventDefault();
  }
  document.addEventListener("keydown", onKey);
  update();

  return {
    relayout,
    destroy() {
      clearTimeout(timer);
      closeZoom();
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("click", closeInfos);
    },
  };
}
