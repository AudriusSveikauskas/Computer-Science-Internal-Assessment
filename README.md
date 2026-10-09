# Driving Theory Practice

A browser-based practice tool for the Lithuanian learner driver theory exam.
Plain HTML, CSS (Tailwind) and JavaScript — no server-side code. The stylesheet
`css/styles.css` is built from Tailwind once and committed, so the app works
without an internet connection. After changing class names, rebuild it with
`npx tailwindcss@3.4.17 -i css/input.css -o css/styles.css --minify`.

## Running it

Serve the folder over http and open the address it prints:

```
python3 -m http.server 8000
```

Opening `index.html` straight from disk mostly works, but the browser then
blocks the automatic loading of the built-in question bank and may also block
local storage, so results would not be saved.

## Question banks

| File | Contents |
|---|---|
| `database/db.lt.csv` | 221 questions in Lithuanian |
| `database/db.en.csv` | the same 221 questions in English |

Both files share the same `id`, `correct`, `difficulty` and `picture` columns
and differ only in wording, so a question keeps its identity across languages
and results carry over between them. The English file is generated from the
Lithuanian one by `tools/build_en_bank.py`, which copies those four columns
from the source so a translation cannot move the correct answer:

```
python3 tools/build_en_bank.py            # rebuild and verify
python3 tools/build_en_bank.py --verify   # verify only
```

The Lithuanian text follows the official Kelių eismo taisyklės. The English
version is a translation for study purposes — where the two differ, the
Lithuanian text and the rules themselves are the authority.

Users can also load their own CSV together with their own images from the
start screen; the `picture` column then holds either a selected file's name or
a full `https://` link.

## Layout

```
index.html      four screens: start, quiz, results, history
css/styles.css  Tailwind classes used by the app, built by tailwind.config.js
src/csv.js      CSV parsing and question validation
src/storage.js  localStorage: profiles, session history, statistics
src/i18n.js     interface translations (en / lt)
src/bank.js     question sources and image resolution
src/session.js  session logic, timer, scoring
src/ui.js       quiz and results rendering
src/history.js  history screen, progress chart, mistake review
src/app.js      shared state and event listeners
tests/          structural and functional tests (see tests/README.md)
tools/          test-data and English-bank build scripts
```

## Tests

```
python3 tools/make_test_data.py   # rebuild the test CSV files
node tests/run_tests.js           # run all tests (needs the playwright package)
node tools/record_video.js out/   # record the demonstration video (.webm)
```

The commentary is text-to-speech: `tools/narration.json` holds the text,
`tools/make_narration.py` turns it into WAV files with Piper,
`node tools/record_video.js out/ narration/` records a video paced by those
clips, and `tools/mix_narration.py out/ narration/ video.mp4` adds the sound.
For a commentary in the candidate's own voice, record each paragraph of
`tools/narration.json` as 01, 02, … 22 (any audio format) and run
`python3 tools/prepare_recordings.py recordings/ narration/` instead of
`make_narration.py`; the video is then paced by those recordings.
