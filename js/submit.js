// Sends records to the Apps Script web app. Every record waits in state.pending until the script acknowledges it, so
// a reload or a lost connection loses nothing; the analysis drops duplicate record_ids.
import { SUBMIT_URL } from "./config.js";

const override = new URLSearchParams(location.search).get("submit");
export const submitUrl = override || SUBMIT_URL;

let flushing = null;

export function enqueue(state, record) {
  state.pending.push(record);
}

async function send(record) {
  const body = JSON.stringify(record);
  try {
    const response = await fetch(submitUrl, {
      method: "POST",
      headers: { "Content-Type": "text/plain;charset=utf-8" },
      body,
      redirect: "follow",
    });
    if (!response.ok) return false;
    const reply = await response.json().catch(() => null);
    return reply?.ok === true;
  } catch {
    // An opaque CORS failure after the script ran would look the same as a lost connection; resending is safe.
    return false;
  }
}

/** Sends the pending records in order; resolves to whether none is left. `onChange` runs after each success. */
export function flush(state, onChange) {
  if (!submitUrl) return Promise.resolve(state.pending.length === 0);
  if (flushing) return flushing;
  flushing = (async () => {
    while (state.pending.length) {
      const ok = await send(state.pending[0]);
      if (!ok) break;
      state.pending.shift();
      onChange?.();
    }
    flushing = null;
    return state.pending.length === 0;
  })();
  return flushing;
}
