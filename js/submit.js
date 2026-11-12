// Sends records to the Apps Script web app. Every record waits in state.pending until it is sent, so a reload or a
// lost connection loses nothing; the analysis drops duplicates (by record_id, and one answer per participant and
// question).
import { SUBMIT_URL } from "./config.js";

const override = new URLSearchParams(location.search).get("submit");
export const submitUrl = override || SUBMIT_URL;

// The last problem, for ?debug.
export const status = { lastError: null, sent: 0, rejected: 0, blind: 0, timeouts: 0 };

// A request may never settle (an iPhone can leave one hanging when the screen locks mid-send), so each is given up
// after SEND_TIMEOUT_MS, and a flush that has not finished a record for STUCK_MS no longer blocks the next one.
const SEND_TIMEOUT_MS = 15000;
const STUCK_MS = 2 * SEND_TIMEOUT_MS + 10000;

let flushing = null;
let flushingSince = 0;

export function enqueue(state, record) {
  state.pending.push(record);
}

/** fetch() that is aborted after SEND_TIMEOUT_MS. */
async function post(options) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), SEND_TIMEOUT_MS);
  try {
    return await fetch(submitUrl, { ...options, method: "POST", signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Sends one record: "sent", "rejected" (the script refused it, so resending cannot help) or "failed" (try later).
 * Some browsers (WebKit on iPhones) may refuse to let the page read the script's reply, which comes from a redirect to
 * another Google domain; the request still reaches the script. In that case the record is sent again in no-cors mode,
 * whose reply is unreadable but whose delivery the browser reports.
 */
async function send(record) {
  const body = JSON.stringify(record);
  const headers = { "Content-Type": "text/plain;charset=utf-8" };
  try {
    const response = await post({ headers, body, redirect: "follow" });
    const reply = await response.json().catch(() => null);
    if (reply?.ok === true) return "sent";
    if (reply && reply.ok === false) {
      status.lastError = `rejected: ${reply.error}`;
      return "rejected";
    }
    status.lastError = `HTTP ${response.status}, unreadable reply`;
  } catch (error) {
    if (error.name === "AbortError") status.timeouts++;
    status.lastError = `${error.name}: ${error.message}`;
  }
  try {
    await post({ mode: "no-cors", headers, body });
    status.blind++;
    return "sent";
  } catch (error) {
    if (error.name === "AbortError") status.timeouts++;
    status.lastError = `offline? ${error.name}: ${error.message}`;
    return "failed";
  }
}

/** Sends the pending records in order; resolves to whether none is left. `onChange` runs after each record. */
export function flush(state, onChange) {
  if (!submitUrl) return Promise.resolve(state.pending.length === 0);
  if (flushing && Date.now() - flushingSince < STUCK_MS) return flushing;
  const run = (async () => {
    while (state.pending.length) {
      const record = state.pending[0];
      const result = await send(record);
      // A newer flush took over while this one hung; it owns the queue now.
      if (flushing !== run) return state.pending.length === 0;
      flushingSince = Date.now();
      if (result === "failed") break;
      if (result === "rejected") status.rejected++;
      else status.sent++;
      if (state.pending[0] === record) state.pending.shift();
      onChange?.();
    }
    flushing = null;
    return state.pending.length === 0;
  })();
  flushing = run;
  flushingSince = Date.now();
  return run;
}
