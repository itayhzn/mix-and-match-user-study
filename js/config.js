// Settings of the study. SUBMIT_URL is the Google Apps Script web app that stores the answers (README, "Collecting
// responses"); while it is empty, answers stay in the browser only. For local tests, ?submit=<url> overrides it.
export const SUBMIT_URL = "https://script.google.com/macros/s/AKfycbwrUXn8OIFerPxEf0wB2MrjcD7yLcbK2hUZ72L7lDxsalbmfP91H9DAUjqFo7xuxuLqlw/exec";

export const APP_VERSION = "1.2.0";

// Questions per session: main ones (balanced across the baselines) and attention checks.
export const MAIN_QUESTIONS = 23;
export const CATCH_QUESTIONS = 2;
// Offered on the done screen.
export const EXTRA_QUESTIONS = 10;

// Next stays disabled this long after a question's images load.
export const MIN_VIEW_MS = 2000;

export const STORAGE_KEY = "study:v1";
export const GALLERY = "gallery";
