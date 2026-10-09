// ============================================================
// run_tests.js — runs every test and saves the results
//
//   node tests/run_tests.js            (needs the playwright package)
//
// 1. Serves the project folder over http, as a user would.
// 2. Opens tests/test.html, which runs the structural tests.
// 3. Runs the functional (black-box) tests: each one drives the
//    real interface with clicks, key presses and file uploads,
//    without calling the app's functions.
// 4. Writes tests/results.json and prints a summary.
// ============================================================

const http = require("http");
const fs = require("fs");
const path = require("path");
const os = require("os");
const { chromium } = require("playwright");

const PROJECT = process.argv[2] ? path.resolve(process.argv[2]) : path.resolve(__dirname, "..");
const DATA = path.join(__dirname, "data");
const PORT = 8790;

const TYPES = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".csv": "text/csv",
                ".jpg": "image/jpeg", ".png": "image/png", ".json": "application/json" };

// Minimal static file server, so no extra tools are needed
function serve(root, port) {
    const server = http.createServer(function (req, res) {
        const file = path.join(root, decodeURIComponent(req.url.split("?")[0]));
        if (!file.startsWith(root) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
            res.writeHead(404); res.end(); return;
        }
        res.writeHead(200, { "Content-Type": TYPES[path.extname(file)] || "application/octet-stream" });
        fs.createReadStream(file).pipe(res);
    });
    return new Promise(function (done) { server.listen(port, function () { done(server); }); });
}

const functional = [];
function record(id, criterion, test, expected, actual, pass) {
    functional.push({ id, criterion, test, expected, actual: String(actual), pass: !!pass });
    console.log((pass ? "PASS " : "FAIL ") + id + " — " + actual);
}

// ----- helpers that only use what a user can see or do -----

async function openApp(browser, base) {
    const page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
    page.on("dialog", function (d) { d.accept(); });
    await page.goto(base + "/index.html");
    await page.waitForSelector("#load-status:not(.hidden)");
    return page;
}

async function uploadBank(page, file) {
    await page.click("#mode-custom");
    await page.setInputFiles("#custom-csv-input", path.join(DATA, file));
    await page.waitForFunction(function () {
        const el = document.getElementById("load-status");
        return !el.classList.contains("hidden") && el.textContent.length > 0;
    });
    return page.textContent("#load-status");
}

const progress = function (page) { return page.textContent("#question-progress"); };
const scoreShown = async function (page) { return parseInt((await page.textContent("#score-display")).replace(/\D/g, "")); };

// The question text and options identify a question; the tests find the
// correct answer the way a person checking a key would: by looking it up
// in the CSV file that was loaded, never by reading the app's variables
function loadKey(file) {
    const text = fs.readFileSync(file, "utf8");
    const key = {};
    // the test files contain no quoted line breaks except quoted.csv, which is not used here
    text.split(/\r?\n/).slice(1).filter(Boolean).forEach(function (line) {
        const f = line.split(",");
        key[f[1]] = { correct: parseInt(f[6]), difficulty: parseInt(f[7]), id: f[0] };
    });
    return key;
}

async function currentQuestion(page, key) {
    const text = await page.textContent("#question-text");
    return Object.assign({ text: text }, key[text]);
}

async function answer(page, option) {
    await page.click('#answer-buttons button[data-index="' + option + '"]');
}

async function next(page) {
    await page.click("#next-btn");
}

async function playSession(page, key, chooseRight) {
    const total = parseInt((await progress(page)).match(/of (\d+)/)[1]);
    const seen = [];
    for (let i = 0; i < total; i++) {
        const q = await currentQuestion(page, key);
        seen.push(q);
        await answer(page, chooseRight(q) ? q.correct : (q.correct % 4) + 1);
        await next(page);
    }
    return seen;
}

async function resultsText(page) {
    await page.waitForSelector("#screen-results:not(.hidden)");
    return page.textContent("#screen-results");
}


async function runFunctional(browser, base) {
    const fixedKey = loadKey(path.join(DATA, "fixed_30.csv"));
    const smallKey = loadKey(path.join(DATA, "small_10.csv"));
    let page, text;

    // F1 — built-in bank loads automatically
    page = await openApp(browser, base);
    const status = await page.textContent("#load-status");
    const statusClass = await page.getAttribute("#load-status", "class");
    const startEnabled = await page.isEnabled("#start-btn");
    record("F1", "CfS 1", "Open the app; built-in bank loads", "\"Loaded 221 valid questions.\" in green; Start enabled",
        "\"" + status + "\"; " + (statusClass.includes("green") ? "green" : "not green") + "; Start " + (startEnabled ? "enabled" : "disabled"),
        status === "Loaded 221 valid questions." && statusClass.includes("green") && startEnabled);

    // F2 — a file with invalid rows
    text = await uploadBank(page, "mixed_10.csv");
    record("F2", "CfS 1", "Upload mixed_10.csv (7 valid, 3 invalid rows)", "7 loaded, 3 skipped, session can start",
        "\"" + text + "\"; Start " + (await page.isEnabled("#start-btn") ? "enabled" : "disabled"),
        text.includes("Loaded 7 valid questions.") && text.includes("Skipped 3 invalid rows.") && await page.isEnabled("#start-btn"));
    await page.close();

    // F3 — a full session has 30 unique questions
    page = await openApp(browser, base);
    await page.click("#start-btn");
    const firstLabel = await progress(page);
    const texts = [];
    let lastLabel = "";
    for (let i = 0; i < 30; i++) {
        texts.push(await page.textContent("#question-text"));
        lastLabel = await progress(page);
        await page.click("#answer-buttons button >> nth=0");
        await next(page);
    }
    record("F3", "CfS 2", "Full session on the built-in bank; note every question", "30 questions, none repeated; \"Question 1 of 30\" … \"Question 30 of 30\"",
        texts.length + " questions, " + new Set(texts).size + " unique; \"" + firstLabel + "\" … \"" + lastLabel + "\"",
        texts.length === 30 && new Set(texts).size === 30 && firstLabel === "Question 1 of 30" && lastLabel === "Question 30 of 30");

    // F4 — two sessions start differently
    const firstFive = [];
    for (let s = 0; s < 2; s++) {
        await page.click("#restart-btn");
        await page.click("#start-btn");
        const five = [];
        for (let i = 0; i < 5; i++) {
            five.push(await page.textContent("#question-text"));
            await page.click("#answer-buttons button >> nth=0");
            await next(page);
        }
        firstFive.push(five);
        await page.click("#quit-btn");
        await page.waitForSelector("#screen-results:not(.hidden)");
    }
    const samePositions = firstFive[0].filter(function (t, i) { return t === firstFive[1][i]; }).length;
    record("F4", "CfS 2", "Start two sessions and compare their first five questions", "different order",
        samePositions + " of 5 positions identical", samePositions < 5);
    await page.close();

    // F5 — fewer than 30 questions available
    page = await openApp(browser, base);
    await uploadBank(page, "small_10.csv");
    await page.click("#start-btn");
    const smallLabel = await progress(page);
    const smallSeen = await playSession(page, smallKey, function () { return true; });
    record("F5", "CfS 2", "Upload small_10.csv and play the session", "10 questions, no crash, \"Question 1 of 10\"",
        "\"" + smallLabel + "\", " + smallSeen.length + " questions played, results shown: " + (await resultsText(page)).includes("Session Complete"),
        smallLabel === "Question 1 of 10" && smallSeen.length === 10);
    await page.close();

    // F6 — weighted scoring
    page = await openApp(browser, base);
    await uploadBank(page, "fixed_30.csv");
    await page.click("#start-btn");
    const rises = {};
    while (Object.keys(rises).length < 3) {
        const q = await currentQuestion(page, fixedKey);
        const before = await scoreShown(page);
        if (rises[q.difficulty] === undefined) {
            const badge = await page.textContent("#difficulty-badge");
            await answer(page, q.correct);
            rises[q.difficulty] = badge + " +" + ((await scoreShown(page)) - before);
        } else {
            await answer(page, q.correct);
        }
        await next(page);
    }
    record("F6", "CfS 3", "Answer an Easy, a Medium and a Hard question correctly", "label shown; score rises by 1, 2, 3",
        [rises[1], rises[2], rises[3]].join(", "), rises[1] === "Easy +1" && rises[2] === "Medium +2" && rises[3] === "Hard +3");

    // F7 / F8 — immediate feedback
    let q = await currentQuestion(page, fixedKey);
    const wrongOption = (q.correct % 4) + 1;
    await answer(page, wrongOption);
    const chosenClass = await page.getAttribute('#answer-buttons button[data-index="' + wrongOption + '"]', "class");
    const correctClass = await page.getAttribute('#answer-buttons button[data-index="' + q.correct + '"]', "class");
    const allDisabled = await page.$$eval("#answer-buttons button", function (b) { return b.every(function (x) { return x.disabled; }); });
    const msgWrong = await page.textContent("#feedback-message");
    record("F7", "CfS 4", "Choose a wrong option", "\"✗ Incorrect\"; chosen option red, correct option green; all options locked",
        "\"" + msgWrong + "\"; chosen " + (chosenClass.includes("red") ? "red" : "?") + ", correct " + (correctClass.includes("green") ? "green" : "?") + ", locked: " + allDisabled,
        msgWrong === "✗ Incorrect" && chosenClass.includes("red") && correctClass.includes("green") && allDisabled);
    await next(page);
    q = await currentQuestion(page, fixedKey);
    await answer(page, q.correct);
    const msgRight = await page.textContent("#feedback-message");
    const rightClass = await page.getAttribute('#answer-buttons button[data-index="' + q.correct + '"]', "class");
    const explanation = await page.isVisible("#explanation-text");
    record("F8", "CfS 4", "Choose the correct option", "\"✓ Correct!\"; option green; explanation shown",
        "\"" + msgRight + "\"; " + (rightClass.includes("green") ? "green" : "?") + "; explanation visible: " + explanation,
        msgRight === "✓ Correct!" && rightClass.includes("green") && explanation);
    await page.close();

    // F9 — accurate total
    page = await openApp(browser, base);
    await uploadBank(page, "fixed_30.csv");
    await page.click("#start-btn");
    await playSession(page, fixedKey, function () { return true; });
    const allRight = await resultsText(page);
    await page.click("#restart-btn");
    await page.click("#start-btn");
    await playSession(page, fixedKey, function (x) { return x.difficulty === 3; });
    const hardOnly = await resultsText(page);
    const grab = function (t) { return (t.match(/(\d+)out of (\d+) possible points \((\d+)%\)/) || []).slice(1).join("/"); };
    record("F9", "CfS 5", "fixed_30.csv: answer all 30 correctly; then only the 10 Hard ones", "60 of 60 (100%); then 30 of 60 (50%)",
        grab(allRight).replace(/\/(\d+)$/, " ($1%)") + "; " + grab(hardOnly).replace(/\/(\d+)$/, " ($1%)"),
        grab(allRight) === "60/60/100" && grab(hardOnly) === "30/60/50");
    await page.close();

    // F10 / F11 — optional timer
    page = await openApp(browser, base);
    await uploadBank(page, "small_10.csv");
    await page.check("#timer-toggle");
    await page.click("#start-btn");
    const wallStart = Date.now();
    const timerAtStart = (await page.textContent("#timer-display")).trim();
    await page.waitForTimeout(7000);
    for (let i = 0; i < 10; i++) {
        const sq = await currentQuestion(page, smallKey);
        await answer(page, sq.correct);
        if (i === 9) break;
        await next(page);
    }
    await next(page);
    const wallSeconds = (Date.now() - wallStart) / 1000;
    const timedResults = await resultsText(page);
    const shownTime = (timedResults.match(/Time taken(\d+:\d\d)/) || [])[1];
    const shownSeconds = shownTime ? parseInt(shownTime.split(":")[0]) * 60 + parseInt(shownTime.split(":")[1]) : -1;
    record("F10", "CfS 6", "Timer on: play small_10.csv for about 7 s, measured independently by the test script",
        "timer starts at 0:00; reported time within 1 s of the measured time",
        "start " + timerAtStart + "; app " + shownTime + ", measured " + wallSeconds.toFixed(2) + " s",
        timerAtStart === "0:00" && Math.abs(shownSeconds - wallSeconds) <= 1);
    await page.click("#restart-btn");
    await page.uncheck("#timer-toggle");
    await page.click("#start-btn");
    const timerVisible = await page.isVisible("#timer-display");
    await playSession(page, smallKey, function () { return true; });
    const untimed = await resultsText(page);
    record("F11", "CfS 6", "Timer off: complete a session", "no timer during the quiz; no time row on results",
        "timer visible: " + timerVisible + "; time row: " + untimed.includes("Time taken"),
        !timerVisible && !untimed.includes("Time taken"));
    await page.close();

    // F12 — results content
    page = await openApp(browser, base);
    await uploadBank(page, "fixed_30.csv");
    await page.click("#start-btn");
    let n = 0;
    await playSession(page, fixedKey, function () { n++; return n % 3 !== 0; });
    const r12 = await resultsText(page);
    const correct = parseInt((r12.match(/Correct answers(\d+)/) || [])[1]);
    const incorrect = parseInt((r12.match(/Incorrect answers(\d+)/) || [])[1]);
    const rows = ["Easy", "Medium", "Hard"].map(function (d) { return (r12.match(new RegExp(d + "(\\d+/\\d+ \\(\\d+%\\))")) || [])[1]; });
    record("F12", "CfS 7", "Complete a session (every third answer wrong) and read the results screen",
        "total score; correct + incorrect = 30; correct/total and % for each difficulty",
        "score " + grab(r12).replace(/^(\d+)\/(\d+)\/(\d+)$/, "$1 of $2 ($3%)") + "; correct " + correct + " + incorrect " + incorrect + "; Easy " + rows[0] + ", Medium " + rows[1] + ", Hard " + rows[2],
        correct + incorrect === 30 && rows.every(Boolean) && grab(r12) !== "");

    // F13 — restart without reload
    await page.evaluate(function () { window.__notReloaded = true; });
    await page.click("#restart-btn");
    await page.check("#timer-toggle");
    await page.click("#start-btn");
    const r13 = [await progress(page), await scoreShown(page), (await page.textContent("#timer-display")).trim(),
                 await page.evaluate(function () { return window.__notReloaded === true; })];
    record("F13", "CfS 8", "On the results screen press \"Start New Session\", then Start", "\"Question 1 of 30\", score 0, timer 0:00, page not reloaded",
        "\"" + r13[0] + "\", score " + r13[1] + ", timer " + r13[2] + ", not reloaded: " + r13[3],
        r13[0] === "Question 1 of 30" && r13[1] === 0 && r13[2] === "0:00" && r13[3]);
    await page.close();

    // F14 — performance with 500 questions
    page = await openApp(browser, base);
    await page.click("#mode-custom");
    const t0 = Date.now();
    await page.setInputFiles("#custom-csv-input", path.join(DATA, "valid_500.csv"));
    await page.waitForFunction(function () { return document.getElementById("load-status").textContent.includes("500"); });
    const loadMs = Date.now() - t0;
    await page.click("#start-btn");
    const answerTimes = [];
    for (let i = 0; i < 10; i++) {
        const ms = await page.evaluate(function () {
            const t = performance.now();
            document.querySelector("#answer-buttons button").click();
            return performance.now() - t;
        });
        answerTimes.push(ms);
        await next(page);
    }
    const slowest = Math.max.apply(null, answerTimes);
    record("F14", "Performance", "Upload valid_500.csv, then answer 10 questions", "loaded in under 2 s; each answer marked in under 0.2 s",
        "loaded in " + loadMs + " ms (upload to message); slowest answer " + slowest.toFixed(1) + " ms",
        loadMs < 2000 && slowest < 200);
    await page.close();

    // F15 — usability, measured on the interface
    page = await browser.newPage({ viewport: { width: 900, height: 1000 } });
    const t15 = Date.now();
    await page.goto(base + "/index.html");
    await page.waitForSelector("#start-btn:not([disabled])");
    const readyMs = Date.now() - t15;
    await page.click("#start-btn");
    let alwaysVisible = true;
    for (let i = 0; i < 30; i++) {
        const label = await page.isVisible("#question-progress");
        const hint = await page.isVisible("#screen-quiz [data-i18n-html='load.tip']");
        const letters = await page.$$eval("#answer-buttons button span:first-child", function (s) { return s.map(function (x) { return x.textContent; }).join(""); });
        if (!label || !hint || !/^AB/.test(letters)) alwaysVisible = false;
        await page.click("#answer-buttons button >> nth=0");
        await next(page);
    }
    record("F15", "Usability", "Open the app with no setup and start a session; check every question screen",
        "session starts with one click after the bank loads; question number, A–D labels and key hint visible on all 30 questions",
        "Start ready after " + readyMs + " ms; 1 click to start; visible on every question: " + alwaysVisible,
        readyMs < 30000 && alwaysVisible);
    await page.close();

    // F16 — reliability with bad files
    page = await openApp(browser, base);
    const emptyMsg = await uploadBank(page, "empty.csv");
    const emptyStart = await page.isEnabled("#start-btn");
    await page.setInputFiles("#custom-csv-input", path.join(DATA, "header_only.csv"));
    await page.waitForTimeout(300);
    const headerMsg = await page.textContent("#load-status");
    const headerStart = await page.isEnabled("#start-btn");
    await page.setInputFiles("#custom-csv-input", path.join(DATA, "small_10.csv"));
    await page.waitForFunction(function () { return document.getElementById("load-status").textContent.includes("10"); });
    const retryMsg = await page.textContent("#load-status");
    record("F16", "Reliability", "Upload empty.csv, then header_only.csv, then a valid file", "error message; Start disabled; no crash; the valid file then loads",
        "\"" + emptyMsg + "\" (Start " + (emptyStart ? "enabled" : "disabled") + "); header only: Start " + (headerStart ? "enabled" : "disabled") + "; retry: \"" + retryMsg + "\"",
        emptyMsg.startsWith("No valid questions found.") && headerMsg.startsWith("No valid questions found.") && !emptyStart && !headerStart && retryMsg.startsWith("Loaded 10 valid questions."));
    await page.close();

    // F17 — keyboard only
    page = await openApp(browser, base);
    await uploadBank(page, "fixed_30.csv");
    await page.focus("#start-btn");
    await page.keyboard.press("Enter");
    for (let i = 0; i < 30; i++) {
        const kq = await currentQuestion(page, fixedKey);
        await page.keyboard.press(["a", "b", "c", "d"][kq.correct - 1]);
        await page.keyboard.press("Enter");
    }
    const keyboardResults = await resultsText(page);
    await page.focus("#restart-btn");
    await page.keyboard.press("Enter");
    const backOnStart = await page.isVisible("#screen-load");
    record("F17", "Accessibility", "Complete a session with the keyboard only (Enter on Start, A–D keys, Enter to continue, Enter on Start New Session)",
        "no mouse needed; 60 of 60; back on the start screen",
        "results \"" + grab(keyboardResults) + "\"; start screen shown again: " + backOnStart,
        grab(keyboardResults) === "60/60/100" && backOnStart);
    await page.close();

    // F18 — portability: decided at the end, from the results of all the other tests
    // F19 — maintainability: change one cell of the CSV, no code
    const copy = fs.mkdtempSync(path.join(os.tmpdir(), "dtp-"));
    fs.cpSync(PROJECT, copy, { recursive: true, filter: function (src) { return !src.includes(path.sep + ".git"); } });
    const bankFile = path.join(copy, "database", "db.en.csv");
    const lines = fs.readFileSync(bankFile, "utf8").split("\n");
    const original = lines[1].split(",")[1];
    lines[1] = lines[1].replace(original, "EDITED: " + original);
    fs.writeFileSync(bankFile, lines.join("\n"));
    const copyServer = await serve(copy, PORT + 1);
    page = await openApp(browser, "http://localhost:" + (PORT + 1));
    // Play sessions until the edited question appears on screen
    let found = false;
    for (let s = 0; s < 40 && !found; s++) {
        await page.click("#start-btn");
        for (let i = 0; i < 30; i++) {
            if ((await page.textContent("#question-text")).startsWith("EDITED:")) { found = true; break; }
            await page.click("#answer-buttons button >> nth=0");
            await next(page);
        }
        if (!found) await page.click("#restart-btn");
    }
    const sourceFiles = ["index.html", "css/styles.css"].concat(fs.readdirSync(path.join(PROJECT, "src")).map(function (f) { return "src/" + f; }));
    const srcChanged = sourceFiles.some(function (f) {
        return fs.readFileSync(path.join(copy, f), "utf8") !== fs.readFileSync(path.join(PROJECT, f), "utf8");
    });
    record("F19", "Maintainability", "Edit the text of question 1 in a copy of db.en.csv only, reload, and play until it appears",
        "edited text appears in the app; no source file changed",
        "edited question shown: " + found + "; source files changed: " + srcChanged, found && !srcChanged);
    await page.close();
    copyServer.close();
    fs.rmSync(copy, { recursive: true, force: true });   // remove the temporary copy

    // F20 — history and practising mistakes (extension of CfS 7)
    page = await openApp(browser, base);
    await uploadBank(page, "fixed_30.csv");
    await page.click("#start-btn");
    const missed = [];
    await playSession(page, fixedKey, function (x) { const right = x.difficulty !== 1; if (!right) missed.push(x.text); return right; });
    await resultsText(page);
    await page.click("#results-history-btn");
    const historyText = await page.textContent("#screen-history");
    await page.click("#history-back-btn");
    const drillLabel = await page.textContent("#drill-btn");
    await page.click("#drill-btn");
    const drillTexts = [];
    const drillTotal = parseInt((await progress(page)).match(/of (\d+)/)[1]);
    for (let i = 0; i < drillTotal; i++) {
        drillTexts.push(await page.textContent("#question-text"));
        await page.click("#answer-buttons button >> nth=0");
        await next(page);
    }
    const onlyMissed = drillTexts.every(function (t) { return missed.includes(t); }) && drillTexts.length === missed.length;
    record("F20", "CfS 9", "Miss the 10 Easy questions of fixed_30.csv; open history; then \"Practise my mistakes\"",
        "history lists the session; drill button offers 10; drill contains exactly the 10 missed questions",
        "history shows session: " + historyText.includes("20/30 correct") + "; button \"" + drillLabel.trim() + "\"; drill " + drillTexts.length + " questions, all previously missed: " + onlyMissed,
        historyText.includes("20/30 correct") && drillLabel.includes("(10)") && onlyMissed);
    await page.close();

    // F21 — own bank with own images
    page = await openApp(browser, base);
    await page.click("#mode-custom");
    await page.setInputFiles("#custom-images-input", [path.join(DATA, "images", "sign1.jpg"), path.join(DATA, "images", "sign2.jpg")]);
    await page.setInputFiles("#custom-csv-input", path.join(DATA, "with_images.csv"));
    await page.waitForFunction(function () { return document.getElementById("load-status").textContent.includes("Loaded"); });
    const imgMsg = await page.textContent("#load-status");
    await page.click("#start-btn");
    let imageShown = false;
    for (let i = 0; i < 3; i++) {
        const visible = await page.isVisible("#question-image");
        const src = await page.getAttribute("#question-image", "src");
        if (visible && src.startsWith("blob:")) imageShown = true;
        await page.click("#answer-buttons button >> nth=0");
        await next(page);
    }
    record("F21", "CfS 10", "Select sign1.jpg and sign2.jpg, then with_images.csv (which also names missing.jpg)",
        "3 questions loaded; missing.jpg reported; a selected picture is shown in the quiz",
        "\"" + imgMsg + "\"; picture shown: " + imageShown,
        imgMsg.includes("Loaded 3 valid questions.") && imgMsg.includes("missing.jpg") && imageShown);
    await page.close();

    // F22 — Lithuanian interface and bank
    page = await openApp(browser, base);
    await page.click("#lang-lt");
    await page.waitForFunction(function () { return document.getElementById("load-status").textContent.includes("Įkelta"); });
    const ltMsg = await page.textContent("#load-status");
    const ltStart = await page.textContent("#start-btn");
    record("F22", "Usability (language)", "Switch the interface to LT", "Lithuanian labels; Lithuanian bank of 221 questions loaded",
        "\"" + ltMsg + "\"; Start button \"" + ltStart + "\"", ltMsg === "Įkelta tinkamų klausimų: 221." && ltStart === "Pradėti testą");
    await page.click("#lang-en");
    await page.close();

    // F24 — no internet connection: every request to another host fails
    const offline = await browser.newContext({ viewport: { width: 900, height: 1000 } });
    await offline.route("**/*", function (route) {
        return route.request().url().startsWith(base) ? route.continue() : route.abort();
    });
    page = await offline.newPage();
    await page.goto(base + "/index.html");
    await page.waitForSelector("#load-status:not(.hidden)");
    const visibleScreens = await page.$$eval("[id^=screen-]", function (s) {
        return s.filter(function (x) { return getComputedStyle(x).display !== "none"; }).length;
    });
    await page.click("#start-btn");
    await page.click("#answer-buttons button >> nth=0");
    const offlineFeedback = await page.isVisible("#feedback-area");
    record("F24", "Reliability (offline)", "Block every request that leaves the computer, open the app and answer a question",
        "only the start screen is shown; the bank loads; a question can be answered",
        "screens shown at start: " + visibleScreens + "; status \"" + (await page.textContent("#load-status")) + "\"; feedback shown: " + offlineFeedback,
        visibleScreens === 1 && offlineFeedback);
    await offline.close();

    // F23 — ending a session early
    page = await openApp(browser, base);
    await page.click("#start-btn");
    for (let i = 0; i < 3; i++) { await page.click("#answer-buttons button >> nth=0"); await next(page); }
    await page.click("#quit-btn");
    const early = await resultsText(page);
    record("F23", "CfS 7 (end early)", "Answer 3 questions, then \"End session early\"", "\"Session Ended\"; results cover the 3 answered questions",
        early.includes("Session Ended") + "; \"Ended after 3 of 30\": " + early.includes("Ended after 3 of 30"),
        early.includes("Session Ended") && early.includes("Ended after 3 of 30"));
    await page.close();
}


(async function main() {
    const server = await serve(PROJECT, PORT);
    const base = "http://localhost:" + PORT;
    const browser = await chromium.launch();

    // Structural tests: wait until test.html reports that it has finished
    const page = await browser.newPage();
    await page.goto(base + "/tests/test.html");
    await page.waitForFunction(function () { return window.testsFinished === true; }, null, { timeout: 120000 });
    const structural = await page.evaluate(function () { return window.testResults; });
    structural.forEach(function (r) { console.log((r.pass ? "PASS " : "FAIL ") + r.id + " " + r.fn + " — " + r.actual); });
    await page.screenshot({ path: path.join(__dirname, "structural_results.png"), fullPage: true });
    await page.close();

    if (!process.argv.includes("--structural-only")) {
        await runFunctional(browser, base);
        // F18 passes only if every other test ran successfully in this browser
        const others = functional.filter(function (r) { return r.id !== "F18"; });
        const failed = others.filter(function (r) { return !r.pass; }).map(function (r) { return r.id; })
            .concat(structural.filter(function (r) { return !r.pass; }).map(function (r) { return r.id; }));
        record("F18", "Portability", "Run every other test in Chromium " + browser.version() + " (the engine also used by Chrome and Edge), with no installation and no server-side code",
            "all other structural and functional tests pass",
            failed.length === 0 ? "all " + (others.length + structural.length) + " other tests passed in Chromium " + browser.version() : "failed: " + failed.join(", "),
            failed.length === 0);
    }

    const summary = {
        date: new Date().toISOString(),
        browser: "Chromium " + browser.version(),
        platform: os.platform() + " " + os.release(),
        structural: structural,
        functional: functional
    };
    if (!process.argv.includes("--structural-only")) {
        fs.writeFileSync(path.join(__dirname, "results.json"), JSON.stringify(summary, null, 2));
    }

    const sPass = structural.filter(function (r) { return r.pass; }).length;
    const fPass = functional.filter(function (r) { return r.pass; }).length;
    console.log("\nStructural: " + sPass + "/" + structural.length + " passed");
    console.log("Functional: " + fPass + "/" + functional.length + " passed");

    await browser.close();
    server.close();
    process.exit(sPass === structural.length && fPass === functional.length ? 0 : 1);
})();
