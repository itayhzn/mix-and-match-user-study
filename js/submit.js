// Sends records to the Apps Script web app. Every record waits in state.pending until it is sent, so a reload or a
// lost connection loses nothing; the analysis drops duplicates (by record_id, and one answer per participant and
// question).
import { SUBMIT_URL } from "./config.js";

const override = new URLSearchParams(location.search).get("submit");
export const submitUrl = override || SUBMIT_URL;

// The last problem, for ?debug.
export const status = { lastError: null, sent: 0, rejected: 0, blind: 0 };

let flushing = null;

export function enqueue(state, record) {
  state.pending.push(record);
}

/**
 * Sends one record: "sent", "rejected" (the script refused it, so resending cannot help) or "failed" (try later).
 * Some browsers (WebKit on iPhones) may refuse to let the page read the script's reply, which comes from a redirect to
 * another Google domain; the request still reaches the script. In that case the record is sent again in no-cors mode,
 * whose reply is unreadable but whose delivery the browser reports.
 */
async function send(record) {
  const body = JSON.stringify(record);
  try {
    const response = await fetch(submitUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body,
      redirect: "follow",
    });
    const reply = await response.json().catch(() => null);
    if (reply?.ok === true) return "sent";
    if (reply && reply.ok === false) {
      status.lastError = `rejected: ${reply.error}`;
      return "rejected";
    }
    status.lastError = `HTTP ${response.status}, unreadable reply`;
  } catch (error) {
    status.lastError = `${error.name}: ${error.message}`;
  }
  try {
    await fetch(submitUrl, { method: "POST", mode: "no-cors", headers: { "Content-Type": "text/plain;charset=utf-8" }, body });
    status.blind++;
    return "sent";
  } catch (error) {
    status.lastError = `offline? ${error.name}: ${error.message}`;
    return "failed";
  }
}

/** Sends the pending records in order; resolves to whether none is left. `onChange` runs after each record. */
export function flush(state, onChange) {
  if (!submitUrl) return Promise.resolve(state.pending.length === 0);
  if (flushing) return flushing;
  flushing = (async () => {
    while (state.pending.length) {
      const result = await send(state.pending[0]);
      if (result === "failed") break;
      if (result === "rejected") status.rejected++;
      else status.sent++;
      state.pending.shift();
      onChange?.();
    }
    flushing = null;
    return state.pending.length === 0;
  })();
  return flushing;
}
