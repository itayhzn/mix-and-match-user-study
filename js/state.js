// The session plan (which questions, in which order, which side ours is on) and its storage.
import { MAIN_QUESTIONS, CATCH_QUESTIONS, STORAGE_KEY } from "./config.js";

// A seeded random generator: xmur3 hashes the seed string, mulberry32 draws from it.
export function rng(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  h = Math.imul(h ^ (h >>> 16), 2246822507);
  h = Math.imul(h ^ (h >>> 13), 3266489909);
  let a = (h ^= h >>> 16) >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function shuffle(items, random) {
  const out = items.slice();
  for (let i = out.length - 1; i > 0; i--) {
    const j = Math.floor(random() * (i + 1));
    [out[i], out[j]] = [out[j], out[i]];
  }
  return out;
}

export function uuid() {
  if (globalThis.crypto?.randomUUID) return crypto.randomUUID();
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

/**
 * Draws a session's questions from the gallery index: `main` questions balanced across the baselines (which baselines
 * get one more is drawn), no library twice and none of `seen`, then `catches` attention checks placed at random within
 * the middle 80%. Each item: {id, catch, oursSide}.
 */
export function makePlan(index, random, { main = MAIN_QUESTIONS, catches = CATCH_QUESTIONS, seen = [] } = {}) {
  const seenIds = new Set(seen.map((s) => s.id));
  const libraries = new Set(index.questions.filter((q) => seenIds.has(q.id)).map((q) => q.library));
  const baselines = shuffle(index.baselines, random);
  const counts = new Map(baselines.map((b, i) => [b, Math.floor(main / baselines.length) + (i < main % baselines.length ? 1 : 0)]));
  const picked = [];
  const take = (baseline, count) => {
    const pool = shuffle(index.questions.filter((q) => q.baseline === baseline), random);
    for (const q of pool) {
      if (count === 0) break;
      if (seenIds.has(q.id) || libraries.has(q.library)) continue;
      picked.push(q.id);
      libraries.add(q.library);
      count--;
    }
    return count;
  };
  let missing = 0;
  for (const [baseline, count] of counts) missing += take(baseline, count);
  // Too few questions left for some baseline: fill from the others.
  for (const baseline of baselines) if (missing > 0) missing = take(baseline, missing);

  const order = shuffle(picked, random).map((id) => ({ id, catch: false }));
  const checks = shuffle(index.catch.filter((id) => !seenIds.has(id)), random).slice(0, catches);
  for (const id of checks) {
    const total = order.length + 1;
    const lo = Math.floor(total * 0.1), hi = Math.max(lo, Math.ceil(total * 0.9) - 1);
    order.splice(lo + Math.floor(random() * (hi - lo + 1)), 0, { id, catch: true });
  }
  return order.map((item) => ({ ...item, oursSide: random() < 0.5 ? "left" : "right" }));
}

export function load() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function save(state) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
}

export function clear() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Storage unavailable: nothing to clear.
  }
}
