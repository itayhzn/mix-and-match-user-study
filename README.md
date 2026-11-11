# Image comparison study

A static web page for a blinded pairwise user study. Each question shows two images on each side of the screen:
the same two prompts rendered by two methods. The participant chooses a side (or a tie) on three questions:
quality, match to the text, and variety. The design is in `context/user-study-design.md` of the research repo.

- **Static:** GitHub Pages serves everything in this repo, with no build step. The site samples each participant's
  questions from the pre-made `gallery/` folder.
- **Responses:** they go to a Google Sheet through a Google Apps Script web app (`backend/apps_script.gs`).

## Layout

| Path | What |
|------|------|
| `index.html`, `css/`, `js/` | The site (plain HTML, CSS and JavaScript modules). |
| `js/config.js` | `SUBMIT_URL` (the Apps Script web app) and the session size: 25 questions, balanced across the baselines. The gallery's attention checks (`C00`–`C03`) are not used. |
| `i18n/en.json`, `i18n/he.json` | Every UI string, in English and Hebrew. |
| `gallery/` | The questions, made by `build_gallery.py` in the research repo: `index.json` and one folder per question with `question.json` and its images (`s/` 512 px, `l/` 1024 px). |
| `assets/` | The example screenshots shown in the instructions. |
| `backend/apps_script.gs` | The script that stores the responses. Not served. |
| `tools/` | Local tools: a test server, the Hebrew translations of the prompts, and their review page. |

## Collecting responses (one-time setup, about 5 minutes)

1. Create a new Google Sheet, for example "Image study responses". Its tabs are created automatically.
2. In the sheet: **Extensions → Apps Script**. Replace the editor's contents with `backend/apps_script.gs` and save.
3. **Deploy → New deployment**, type **Web app**, with:
   - Execute as: **Me**
   - Who has access: **Anyone**

   Authorize it when asked. Google warns that the app is unverified; choose Advanced → Go to the project.
4. Copy the **Web app URL**, which ends in `/exec`. Put it in `js/config.js` as `SUBMIT_URL`, then commit and push.
5. Check it: opening the URL in a browser shows `{"ok":true,"service":"study responses"}`.

To change the script later, use **Deploy → Manage deployments → Edit → Version: New version**. That keeps the same
URL.

The sheet gets three tabs:
- `session`: one row per participant, with the name, language, device and gallery version.
- `withdraw`: one row per participant who chose "Exit without saving". The analysis drops all of their answers.
- `response`: one row per answered question.
  - `answer_*` holds the side chosen: left, tie or right.
  - `pref_*` holds the same answer as ours, tie or other.
  - The row also records the question, the baseline, whether it was an attention check, and the timings.

## Testing locally

```
python3 tools/dev_server.py --port 8000
open "http://localhost:8000/?submit=http://localhost:8000/submit"
```

The test server serves the site and writes every response to `tools/records.jsonl`.

URL parameters:
- `?reset` starts a new session in this browser.
- `?submit=<url>` sends the answers to another endpoint.

## Updating the gallery

1. Build the gallery on the cluster with `custom/Mix_n_match/user_study/build_gallery.py`, and copy its `gallery/`
   folder here.
2. Run `python3 tools/apply_translations.py --missing tools/untranslated.json` to list the prompts that have no
   Hebrew yet.
3. Add their translations to `tools/translations_he.json`, keeping the `<rN>…</rN>` tags.
4. Run `python3 tools/apply_translations.py`. It checks that each translation has the same tags as the English.
5. Run `python3 tools/make_review.py` and read `tools/translation_review.html`.

A new gallery has a new version. Sessions started on the old one start over, and their answers already sent remain
in the sheet.
