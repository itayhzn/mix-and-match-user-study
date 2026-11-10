/**
 * Stores the study's records in this spreadsheet: one row per record, in the sheet named after its type ("session" or
 * "response"). Columns are matched by name in row 1; a field without a column gets a new one, so the sheets need no
 * setup. Deploy as a web app (Execute as: Me, Who has access: Anyone) and put its /exec URL in js/config.js.
 */
const TYPES = ["session", "response"];
const MAX_FIELD = 200;
const TRIAL_ID = /^(Q\d{3}|C\d{2})$/;

function doPost(e) {
  let record;
  try {
    record = JSON.parse(e.postData.contents);
  } catch (error) {
    return reply({ ok: false, error: "not JSON" });
  }
  const problem = validate(record);
  if (problem) return reply({ ok: false, error: problem });

  const lock = LockService.getScriptLock();
  lock.waitLock(20000);
  try {
    const book = SpreadsheetApp.getActiveSpreadsheet();
    const sheet = book.getSheetByName(record.type) || book.insertSheet(record.type);
    const fields = Object.keys(record).concat(["received_at"]);
    record.received_at = new Date().toISOString();
    let header = sheet.getLastColumn() ? sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0] : [];
    const missing = fields.filter((f) => header.indexOf(f) < 0);
    if (missing.length) {
      sheet.getRange(1, header.length + 1, 1, missing.length).setValues([missing]);
      header = header.concat(missing);
      sheet.setFrozenRows(1);
    }
    sheet.appendRow(header.map((f) => (f in record ? cell(record[f]) : "")));
  } finally {
    lock.releaseLock();
  }
  return reply({ ok: true });
}

function doGet() {
  return reply({ ok: true, service: "study responses" });
}

function validate(record) {
  if (!record || typeof record !== "object" || Array.isArray(record)) return "not an object";
  if (TYPES.indexOf(record.type) < 0) return "unknown type";
  if (!record.record_id || !record.participant_id) return "missing ids";
  if (record.type === "response" && !TRIAL_ID.test(String(record.trial_id))) return "bad trial_id";
  const keys = Object.keys(record);
  if (keys.length > 60) return "too many fields";
  for (const key of keys) {
    const value = record[key];
    if (value !== null && typeof value === "object") return "nested field " + key;
    if (String(value).length > (key === "user_agent" ? 400 : MAX_FIELD)) return "field too long: " + key;
  }
  return null;
}

// Strings that a spreadsheet would read as a formula are stored as text.
function cell(value) {
  if (typeof value === "string" && /^[=+\-@]/.test(value)) return "'" + value;
  return value;
}

function reply(object) {
  return ContentService.createTextOutput(JSON.stringify(object)).setMimeType(ContentService.MimeType.JSON);
}
