// ============================================================
// build_ia.js — builds the IA report (docx) from the project itself.
//
//   NODE_PATH=$(npm root -g) node docs/ia/build_ia.js
//
// Every number about the product is read, not typed: test results
// come from tests/results.json, code excerpts and their line numbers
// from the source files, data counts from the CSV files. The word
// count on the cover is computed from the prose paragraphs only
// (headings, tables, figures, captions, code and references excluded).
// ============================================================

const fs = require("fs");
const path = require("path");
const {
    Document, Packer, Paragraph, TextRun, ImageRun, Table, TableRow, TableCell,
    AlignmentType, HeadingLevel, WidthType, ShadingType, BorderStyle, PageBreak,
    Footer, PageNumber, LevelFormat, TableLayoutType
} = require("docx");

const ROOT = path.resolve(__dirname, "..", "..");
const IMG = path.join(__dirname, "img");
const OUT = path.join(__dirname, "IA_Driving_Theory_Practice.docx");

const results = JSON.parse(fs.readFileSync(path.join(ROOT, "tests", "results.json"), "utf8"));
const S = {}; results.structural.forEach(r => S[r.id] = r);
const F = {}; results.functional.forEach(r => F[r.id] = r);

// ---------- facts read from the project ----------
const src = f => fs.readFileSync(path.join(ROOT, f), "utf8").split("\n");
function lineOf(file, text, from) {
    const lines = src(file);
    for (let i = (from || 1) - 1; i < lines.length; i++) if (lines[i].includes(text)) return i + 1;
    throw new Error("Not found in " + file + ": " + text);
}
function functionRange(file, name) {
    const start = lineOf(file, "function " + name + "(");
    const lines = src(file);
    for (let i = start; i < lines.length; i++) if (lines[i] === "}") return [start, i + 1];
    throw new Error("No end for " + name);
}
const jsFiles = fs.readdirSync(path.join(ROOT, "src")).filter(f => f.endsWith(".js"));
const lineCounts = {}; jsFiles.forEach(f => lineCounts[f] = src("src/" + f).length - (src("src/" + f).slice(-1)[0] === "" ? 1 : 0));
const passS = results.structural.filter(r => r.pass).length;
const passF = results.functional.filter(r => r.pass).length;
const browser = results.browser;
const loadMs = F.F14.actual.match(/loaded in (\d+) ms/)[1];
const slowMs = F.F14.actual.match(/slowest answer ([\d.]+) ms/)[1];
const f10 = F.F10.actual.match(/app (\d+:\d\d), measured ([\d.]+) s/);
const s10 = S.S10.actual.match(/\d+: (\d+)/g).map(x => +x.split(": ")[1]);
const shuffleCmp = fs.readFileSync(path.join(ROOT, "tests", "shuffle_comparison.txt"), "utf8");
const sortCounts = JSON.parse(shuffleCmp.match(/sort\(random - 0\.5\): (\{.*\})/)[1]);
const fyCounts = JSON.parse(shuffleCmp.match(/Fisher-Yates:\s+(\{.*\})/)[1]);
const before = fs.readFileSync(path.join(ROOT, "tests", "results_before_fix.txt"), "utf8");
const failedBefore = (before.match(/^FAIL (\w+)/gm) || []).map(x => x.slice(5));
if (failedBefore.join() !== "S4,F15,F24") throw new Error("Unexpected pre-fix failures: " + failedBefore);

// Line numbers quoted in the text
const L = {
    escStart: lineOf("src/csv.js", "if (char === '\"' && inQuotes && text[i + 1] === '\"')"),
    keyScreen: lineOf("src/app.js", 'if (document.getElementById("screen-quiz").classList.contains("hidden")) return;'),
    keyExists: lineOf("src/app.js", "if (q.options[index - 1] && q.options[index - 1].length > 0)"),
    keyEnter: lineOf("src/app.js", 'if ((e.key === "Enter" || e.key === " ") && answered)'),
};
L.escEnd = L.escStart + 3;

// ---------- formatting helpers ----------
const FONT = "Arial";
const W = 9638;                 // text width in DXA: A4 minus 2 cm margins
let words = 0;
const countWords = t => t.split(/\s+/).filter(w => /[A-Za-z0-9]/.test(w)).length;

function runs(text, base) {
    // **bold** and `code` inside a string
    const out = [];
    text.split(/(\*\*[^*]+\*\*|`[^`]+`)/).forEach(part => {
        if (!part) return;
        if (part.startsWith("**")) out.push(new TextRun(Object.assign({ text: part.slice(2, -2), bold: true }, base)));
        else if (part.startsWith("`")) out.push(new TextRun(Object.assign({ text: part.slice(1, -1), font: "Consolas", size: 19 }, base)));
        else out.push(new TextRun(Object.assign({ text: part }, base)));
    });
    return out;
}
function plainOf(text) { return text.replace(/\*\*|`/g, ""); }
// Prose paragraph: counted in the word count
function P(text) {
    words += countWords(plainOf(text));
    return new Paragraph({ children: runs(text), spacing: { after: 120, line: 276 } });
}
// Non-counted paragraph (notes, captions, cover, references)
function N(text, opts) {
    return new Paragraph(Object.assign({ children: runs(text, (opts && opts.run) || {}), spacing: { after: 100 } }, (opts && opts.para) || {}));
}
const sectionWords = {}; let lastH1 = null, lastCount = 0;
const H1 = t => { if (lastH1) sectionWords[lastH1] = words - lastCount; lastH1 = t; lastCount = words; return H1p(t); };
const H1p = t => new Paragraph({ heading: HeadingLevel.HEADING_1, children: [new TextRun(t)], pageBreakBefore: true });
const H2 = t => new Paragraph({ heading: HeadingLevel.HEADING_2, children: [new TextRun(t)] });
const H3 = t => new Paragraph({ heading: HeadingLevel.HEADING_3, children: [new TextRun(t)] });
const caption = t => new Paragraph({ alignment: AlignmentType.CENTER, spacing: { after: 200 }, children: [new TextRun({ text: t, italics: true, size: 18, color: "444444" })] });

function pngSize(file) {
    const b = fs.readFileSync(file);
    return [b.readUInt32BE(16), b.readUInt32BE(20)];
}
function figure(file, cap, maxW, maxH) {
    const full = path.join(IMG, file);
    const [w, h] = pngSize(full);
    const scale = Math.min((maxW || 620) / w, (maxH || 820) / h);
    return [
        new Paragraph({ alignment: AlignmentType.CENTER, keepNext: true, children: [new ImageRun({
            type: "png", data: fs.readFileSync(full),
            transformation: { width: Math.round(w * scale), height: Math.round(h * scale) },
            altText: { title: cap, description: cap, name: file } })] }),
        caption(cap)
    ];
}

const border = { style: BorderStyle.SINGLE, size: 4, color: "BBBBBB" };
const borders = { top: border, bottom: border, left: border, right: border };
function cell(text, width, opts) {
    opts = opts || {};
    const paras = String(text).split("\n").map(line => new Paragraph({
        spacing: { after: 0 }, children: runs(line, { size: opts.size || 17, bold: !!opts.bold, color: opts.color })
    }));
    return new TableCell({
        width: { size: width, type: WidthType.DXA }, borders,
        shading: opts.fill ? { fill: opts.fill, type: ShadingType.CLEAR, color: "auto" } : undefined,
        margins: { top: 50, bottom: 50, left: 80, right: 80 },
        children: paras
    });
}
function table(headers, rows, widths, opts) {
    const total = widths.reduce((a, b) => a + b, 0);
    widths = widths.map(w => Math.round(w * W / total));
    widths[widths.length - 1] += W - widths.reduce((a, b) => a + b, 0);
    return new Table({
        width: { size: W, type: WidthType.DXA }, columnWidths: widths, layout: TableLayoutType.FIXED,
        rows: [new TableRow({ tableHeader: true, children: headers.map((h, i) => cell(h, widths[i], { bold: true, fill: "E8EEF7" })) })]
            .concat(rows.map(r => new TableRow({ cantSplit: true, children: r.map((c, i) => {
                const pass = c === "Pass", fail = c === "Fail";
                return cell(c, widths[i], { fill: pass ? "E7F6EC" : fail ? "FDE8E8" : (opts && opts.shadeFirst && i === 0 ? "F7F7F7" : undefined) });
            }) })))
    });
}
const gap = () => new Paragraph({ spacing: { after: 120 }, children: [] });

// Code excerpt with the real line numbers of the file
function code(file, from, to, cap, skip) {
    const lines = src(file);
    const paras = [];
    for (let n = from; n <= to; n++) {
        if (skip && n >= skip[0] && n <= skip[1]) {
            if (n === skip[0]) paras.push(codeLine("    ", "   …"));
            continue;
        }
        paras.push(codeLine(String(n).padStart(4, " "), lines[n - 1]));
    }
    return paras.concat([caption(cap + " — " + file + ", lines " + from + "–" + to + " (Appendix A)")]);
}
function codeLine(num, text) {
    return new Paragraph({
        spacing: { after: 0, line: 240 },
        shading: { fill: "F4F4F4", type: ShadingType.CLEAR, color: "auto" },
        children: [new TextRun({ text: num + "  ", font: "Consolas", size: 16, color: "888888" }),
                   new TextRun({ text: text.replace(/\t/g, "    "), font: "Consolas", size: 16 })]
    });
}

// ============================================================
// CONTENT
// ============================================================
const body = [];
const add = (...xs) => xs.forEach(x => Array.isArray(x) ? body.push(...x) : body.push(x));

// ---------------- Criterion A ----------------
add(H1("Criterion A: Problem specification"));
add(H2("Problem scenario"));
add(P("Learner drivers in Lithuania must pass the theory test at Regitra, a computer-based test of 30 multiple-choice questions on the road traffic rules [2]. Learners prepare by answering practice questions, and a practice tool only helps if it does not repeat questions within a session, shows straight away whether an answer was right and why, shows which kinds of question are answered badly, and lets the learner return to earlier mistakes. Regitra updates its exam questions from time to time [1], so the question bank must be editable without programming."));
add(P("The solution must therefore load a question bank from a CSV file, run sessions of 30 unique questions in random order, score answers by difficulty, give immediate feedback with an explanation, summarise the results by difficulty, and store every session on the device so that the most-missed questions can be practised again. It must load 500 questions in under 2 seconds and mark an answer in under 0.2 seconds."));
add(H2("Computational context"));
add(P("The solution is a single-page web application written in plain JavaScript and run in a web browser (Table A1). A browser is already on every laptop, so nothing is installed, and it handles mouse and keyboard events. Everything runs on the user's device: the built-in bank is read from CSV files in the project folder, a user's own bank is read with the File API, and results are kept in the browser's localStorage, so no answers leave the computer. CSV was chosen because a non-programmer can edit it in a spreadsheet."));
add(table(["Context", "Chosen", "Alternatives considered", "Justification"], [
    ["Language", "JavaScript (ES6), HTML", "Python + Tkinter; Java + JavaFX", "Runs in any browser with no installation; DOM events give mouse and keyboard input directly. Python and Java need a runtime on every laptop."],
    ["Libraries / frameworks", "None for logic; Tailwind CSS 3.4 for styling, built into css/styles.css", "React; PapaParse for CSV", "Four screens do not need a component framework. Tailwind is built once into css/styles.css, so the app needs no build step to run. The CSV parser is written by hand so the algorithm is visible (Criterion D)."],
    ["Software environment", "Web browser, page served by a local http server (python3 -m http.server)", "Opening index.html from disk", "Browsers block fetch() of the built-in bank from file://; the app then offers a manual file picker instead (bank.js)."],
    ["Hardware", "Any laptop that runs a current browser", "Mobile phone", "Keyboard control (A–D, Enter) suits a laptop; no special hardware is used."],
    ["Data environment", "CSV, UTF-8, 10 columns; built-in bank of 221 questions in Lithuanian and English with 221 pictures", "SQL database; JSON", "Editable in a spreadsheet; no database server. The two language files share id, correct, difficulty and picture."],
    ["Storage of results", "Browser localStorage, JSON", "Server database; IndexedDB", "No server or accounts; answers stay on the device (Criterion D, Technique 6)."],
], [14, 22, 20, 44]));
add(caption("Table A1 — Computational context"));
add(H2("Success criteria"));
add(table(["No.", "Success criterion (measurable)"], [
    ["1", "CSV import: questions load from a CSV file (built-in or the user's own). Rows with empty question text, a correct answer outside 1–4, a difficulty outside 1–3, or a correct answer pointing at an empty option are skipped, and the numbers loaded and skipped are reported."],
    ["2", "Session: a session holds 30 questions (all of them if fewer than 30 are loaded), with no question repeated, in random order."],
    ["3", "Weighted scoring: each question shows its difficulty (Easy, Medium, Hard); a correct answer scores 1, 2 or 3 points respectively."],
    ["4", "Immediate feedback: after each answer the app states whether it was correct, marks the correct option green and a wrong choice red, shows the explanation, and locks the options."],
    ["5", "Accurate score: the total equals the sum of the points earned; the percentage is calculated against the points available for the questions answered."],
    ["6", "Optional timer: when enabled, timing starts at the first question and stops at the end; the elapsed time is reported to the nearest second."],
    ["7", "Results: the end screen shows the total score, the numbers of correct and incorrect answers, correct/total and % per difficulty, and the time if timed. A session can be ended early; its results then cover the questions answered."],
    ["8", "Restart: a new session can be started without reloading the page; it is reshuffled and all counters and the timer are reset."],
    ["9", "History and mistakes: every session is saved on the device under a profile name; a history screen shows past scores, a progress chart and the most-missed questions; “Practise my mistakes” runs a session of up to 30 previously missed questions."],
    ["10", "Own question bank: the user can load their own CSV file with their own images; picture names that are not among the selected images are reported."],
], [6, 94], { shadeFirst: true }));
add(caption("Table A2 — Functional success criteria (CfS)"));
add(table(["Criterion", "Measure"], [
    ["Performance", "A bank of 500 questions loads in under 2 s; an answer is marked in under 0.2 s."],
    ["Usability", "A session starts with one click once the bank has loaded; the question number, the A–D labels and the key hint are visible on every question; the interface and the built-in bank are available in Lithuanian and English."],
    ["Reliability", "An empty or invalid file gives an error message, keeps Start disabled and does not crash the app; corrupted stored data gives an empty history; the app works without an internet connection."],
    ["Accessibility", "A whole session can be completed with the keyboard only."],
    ["Portability", "Runs in a current browser with no installation and no server-side code."],
    ["Maintainability", "The questions can be changed by editing the CSV file only, without changing any source file."],
], [18, 82], { shadeFirst: true }));
add(caption("Table A3 — Non-functional criteria"));

// ---------------- Criterion B ----------------
add(H1("Criterion B: Planning"));
add(P("Figure B1 decomposes the problem into six components; every success criterion belongs to at least one of them. The plan in Figure B2 has two iterations. In iteration 1 (weeks 1–7) one component of the core product (CfS 1–8) is designed, built, tested and evaluated each week, so a working program exists at the end of every week. Research comes first: the browser File API, the CSV format [3] and the Fisher–Yates shuffle [4]. Iteration 2 (weeks 8–12) adds history, own banks and the second language (CfS 9–10), and ends with a full test run, the evaluation and the video."));
add(figure("structure_chart.png", "Figure B1 — Decomposition of the problem into components, with the success criteria each one serves", 620, 560));
add(figure("gantt.png", "Figure B2 — Gantt chart: each component is designed (D), built (B), tested (T) and evaluated (E)", 640, 420));

// ---------------- Criterion C ----------------
add(H1("Criterion C: System overview"));
add(H2("System model"));
add(P("Figure C1 shows the eight JavaScript files loaded by index.html, the data stores and the calls between them. The rules of interaction are: listeners for the controls in index.html are attached only in app.js, while buttons created at run time get theirs where they are created (ui.js, history.js); the session counters declared in app.js are changed only by session.js and ui.js; storage.js is the only file that reads or writes localStorage; and interface text is looked up in i18n.js, so the language can be switched."));
add(figure("system_model.png", "Figure C1 — System model: files, data stores and the functions through which they interact", 560, 700));
add(H2("Data"));
add(table(["Column", "Type", "Rule (✓ = checked by isValidQuestion)"], [
    ["id", "text", "Identifies the question; the same id in db.lt.csv and db.en.csv is the same question."],
    ["question", "text", "✓ Must not be empty."],
    ["option_a … option_d", "text", "Up to 4 options; unused options are empty."],
    ["correct", "integer 1–4", "✓ Must be 1–4 and point at a non-empty option."],
    ["difficulty", "integer 1–3", "✓ Must be 1–3: 1 Easy, 2 Medium, 3 Hard."],
    ["explanation", "text", "Optional; shown after answering."],
    ["picture", "text", "Optional; a file name (assets/ or a selected image) or an https:// link."],
], [22, 16, 62]));
add(caption("Table C1 — CSV question format (fields may be quoted and contain commas, quotes and line breaks)"));
add(table(["Variable (app.js)", "Type", "Meaning"], [
    ["questions", "array of question objects", "All valid questions of the loaded bank."],
    ["sessionQuestions", "array (≤ 30)", "The questions of the current session."],
    ["currentIndex", "integer", "Position of the question on screen."],
    ["score, correctCount, incorrectCount", "integers", "Running totals."],
    ["answered", "boolean", "True once the current question has been answered."],
    ["diffStats", "{1|2|3: {correct, total}}", "Breakdown by difficulty."],
    ["sessionAnswers", "array of {qid, chosen, correct, difficulty, ok}", "One record per answer; snippets of text are added for wrong answers."],
    ["timerEnabled, startTime, elapsedSeconds", "boolean, ms timestamp, integer", "Timer state."],
    ["activeProfile, currentBank, currentLanguage", "text", "Whose history is used, which bank is loaded, \"en\" or \"lt\"."],
], [32, 26, 42]));
add(caption("Table C2 — Session state"));
add(table(["localStorage key", "Contents"], [
    ["dtp.history.v1.<profile>", "Array of session records (newest 100): id, date, profile, bank, mode (\"all\" or \"mistakes\"), score, maxScore, percent, correct, incorrect, total, planned, abandoned, timerEnabled, seconds, diffStats, answers."],
    ["dtp.profiles.v1", "List of profile names used on this device."],
    ["dtp.activeProfile.v1", "Name of the profile selected last."],
    ["dtp.lang.v1", "\"en\" or \"lt\"."],
], [30, 70]));
add(caption("Table C3 — Data stored in the browser (storage.js, i18n.js)"));
add(H2("User interface"));
add(figure("screen_flow.png", "Figure C2 — The four screens and the controls that move between them", 520, 430));
add(new Table({ width: { size: W, type: WidthType.DXA }, columnWidths: [W / 2, W / 2], layout: TableLayoutType.FIXED,
    rows: [new TableRow({ children: [
        new TableCell({ width: { size: W / 2, type: WidthType.DXA }, borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
            children: figure("ui_start.png", "Figure C3 — Start screen", 300, 420) }),
        new TableCell({ width: { size: W / 2, type: WidthType.DXA }, borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
            children: figure("ui_quiz.png", "Figure C4 — Quiz screen (timer on)", 300, 420) })
    ] }), new TableRow({ children: [
        new TableCell({ width: { size: W / 2, type: WidthType.DXA }, borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
            children: figure("ui_feedback.png", "Figure C5 — Feedback after a wrong answer", 300, 480) }),
        new TableCell({ width: { size: W / 2, type: WidthType.DXA }, borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
            children: figure("ui_results.png", "Figure C6 — Results screen", 300, 480) })
    ] }), new TableRow({ children: [
        new TableCell({ width: { size: W / 2, type: WidthType.DXA }, borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
            children: figure("ui_history_top.png", "Figure C7 — History: statistics, progress chart, most-missed questions", 300, 600) }),
        new TableCell({ width: { size: W / 2, type: WidthType.DXA }, borders: { top: { style: BorderStyle.NONE }, bottom: { style: BorderStyle.NONE }, left: { style: BorderStyle.NONE }, right: { style: BorderStyle.NONE } },
            children: figure("ui_custom.png", "Figure C8 — Own question bank with images", 300, 440).concat(figure("ui_history_review.png", "Figure C9 — History: review of one session's mistakes", 300, 300)) })
    ] })] }));
add(H2("Algorithms"));
add(P("Flowcharts C10–C15 give the main flow of the program and the algorithms of the components that carry its logic."));
add(figure("fc_main_load.png", "Figure C10a — Main flow, part 1: loading a question bank (app.js, bank.js)", 330, 470));
add(figure("fc_main_start.png", "Figure C10b — Main flow, part 2: starting a session (session.js)", 420, 640));
add(figure("fc_main_loop.png", "Figure C10c — Main flow, part 3: the quiz loop (session.js, ui.js)", 300, 620));
add(figure("fc_parse.png", "Figure C11 — parseCSV() and isValidQuestion() (csv.js)", 640, 600));
add(figure("fc_answer.png", "Figure C12 — handleAnswer() (ui.js)", 420, 640));
add(figure("fc_shuffle.png", "Figure C13 — shuffle(): Fisher–Yates shuffle on a copy (session.js)", 240, 380));
add(figure("fc_weak.png", "Figure C14 — getWeakQuestions() and the “Practise my mistakes” pool (storage.js, session.js)", 300, 640));
add(figure("fc_save.png", "Figure C15 — saveHistory(): keeps the newest sessions when storage is full (storage.js)", 420, 300));
add(H2("Testing strategy"));
add(P("Testing is done at two levels. Structural (white-box) tests (Table C5) call each major function inside the running application with valid, extreme and invalid data, so that the main branches and the error paths for invalid rows, corrupted storage and full storage are exercised. Functional (black-box) tests (Table C4) check every success criterion through the interface only, by clicking, typing and uploading files, and look up the correct answers in the CSV file rather than in the program. Generated test files (Table C6) make the expected results exact: fixed_30.csv holds ten questions of each difficulty, so its maximum score is 60 by hand calculation. Both levels are automated so that they can be repeated after every change."));
add(table(["No.", "Criterion", "Test", "Expected outcome"], results.functional.slice().sort((a, b) => +a.id.slice(1) - +b.id.slice(1)).map(r => [r.id, r.criterion, r.test, r.expected]), [6, 14, 42, 38]));
add(caption("Table C4 — Functional test plan"));
add(table(["No.", "Function", "Type", "Test data", "Expected outcome"], results.structural.slice().sort((a, b) => +a.id.slice(1) - +b.id.slice(1)).map(r => [r.id, r.fn, r.type, r.data, r.expected]), [6, 17, 9, 36, 32]));
add(caption("Table C5 — Structural test plan (valid, extreme and invalid data)"));
add(table(["File (tests/data/)", "Contents", "Used in"], [
    ["valid_500.csv", "500 valid questions", "F14"],
    ["mixed_10.csv", "7 valid rows; 3 invalid: blank question, correct = 5, difficulty “Hard”", "F2"],
    ["fixed_30.csv", "10 Easy, 10 Medium, 10 Hard (maximum 60 points)", "F6–F9, F12, F17, F20, S14, S24–S27"],
    ["small_10.csv", "10 valid questions", "F5, F10, F11, F16"],
    ["quoted.csv, quoted_crlf.csv, quoted_no_final_newline.csv", "A comma, a line break and escaped quotes inside fields; Windows line endings; no final newline", "S1–S4"],
    ["with_images.csv + images/", "3 questions; 2 of the 3 named pictures provided", "F21"],
    ["empty.csv, header_only.csv", "0 bytes; header row only", "F16, S3 (S5 parses the same empty text directly)"],
], [30, 50, 20]));
add(caption("Table C6 — Test data, generated by tools/make_test_data.py"));

// ---------------- Criterion D ----------------
add(H1("Criterion D: Development"));
add(H2("Structure of the product"));
add(P("The product has eight JavaScript files (Table D1), grouped by the components of Figure B1, plus app.js for the shared state and the event listeners. This let each part be tested on its own (S1–S31)."));
add(table(["File", "Lines", "Responsibility", "Component (Figure B1)", "CfS"], [
    ["csv.js", lineCounts["csv.js"], "Parse and validate CSV text", "1. Question bank", "1"],
    ["bank.js", lineCounts["bank.js"], "Built-in or own bank; pictures; load messages", "1. Question bank", "1, 10"],
    ["session.js", lineCounts["session.js"], "Shuffle, select, timer, start/finish/quit", "2. Session logic", "2, 6, 8"],
    ["ui.js", lineCounts["ui.js"], "Render questions, mark answers, results", "3. Quiz interface, 4. Results", "3, 4, 5, 7"],
    ["storage.js", lineCounts["storage.js"], "localStorage, statistics, export/import", "5. History & review", "9"],
    ["history.js", lineCounts["history.js"], "History screen, chart, mistake review", "5. History & review", "9"],
    ["i18n.js", lineCounts["i18n.js"], "Interface text in English and Lithuanian", "6. Language", "Usability"],
    ["app.js", lineCounts["app.js"], "Shared state and all static event listeners", "—", "Accessibility"],
], [14, 8, 40, 24, 14]));
add(caption("Table D1 — Files of the product (full source code in Appendix A)"));

// Technique 1
add(H2("Technique 1 — CSV parsing as a state machine (CfS 1)"));
const [pcStart] = [lineOf("src/csv.js", "for (let i = 0; i < text.length; i++)")];
add(code("src/csv.js", pcStart, pcStart + 27, "Code D1 — parseCSV() main loop"));
const [ivS, ivE] = functionRange("src/csv.js", "isValidQuestion");
add(P("**Technique.** `parseCSV()` reads the text once, character by character, as a two-state machine: the `inQuotes` flag decides whether a comma or a line break ends a field (Code D1, Figure C11). `isValidQuestion()` (lines " + ivS + "–" + ivE + ") then rejects rows that cannot be used; they are counted and reported instead of stopping the import."));
const lt = require("child_process").execSync("python3 -c \"import csv; r=list(csv.DictReader(open('" + path.join(ROOT, "database", "db.lt.csv") + "',encoding='utf-8-sig'))); print(sum(1 for x in r if any(chr(10) in v for v in x.values())), sum(1 for x in r if any(',' in x[k] for k in ['question','option_a','option_b','option_c','option_d'])))\"").toString().trim().split(" ");
const quoteRows = require("child_process").execSync("python3 -c \"import csv\nfor f in ['db.en.csv','db.lt.csv']:\n  r=list(csv.reader(open('" + path.join(ROOT, "database") + "/'+f,encoding='utf-8-sig')))[1:]\n  print(sum(1 for x in r if any(chr(34) in v for v in x)))\"").toString().trim().split("\n");
add(P("**Evaluation.** Splitting the text on line breaks and then on commas is simpler but fails on this data: " + lt[0] + " questions in db.lt.csv contain a line break inside a quoted field and " + lt[1] + " contain a comma in the question or an option, so their columns would shift. The PapaParse library [5] would handle this but adds a dependency and hides the algorithm. One pass is O(n) in the length of the file; 500 questions loaded in " + loadMs + " ms (F14). A weakness remains: an unclosed quote turns the rest of the file into one field, and the faulty line is not reported."));
add(P("**Testing.** S1–S8, F1, F2 and F16. Extreme test S4 found a real defect: two quotes inside a quoted field were dropped, so “Cyclists” lost its quotation marks. " + quoteRows[0] + " questions in db.en.csv and " + quoteRows[1] + " in db.lt.csv contain quotation marks. Lines " + L.escStart + "–" + L.escEnd + " now read two quotes as one; S4 fails on the earlier commit 12a16ba and passes now."));

// Technique 2
add(H2("Technique 2 — Fisher–Yates shuffle and session selection (CfS 2, 8)"));
const [shS, shE] = functionRange("src/session.js", "shuffle");
add(code("src/session.js", shS, shE, "Code D2 — shuffle()"));
const selLine = lineOf("src/session.js", "const shuffled = shuffle(questions);");
add(P("**Technique.** `shuffle()` copies the array and, from the last position down, swaps each element with a random element at or before it (Code D2, Figure C13). `startSession()` then takes the first min(30, n) questions (line " + (selLine + 1) + "). Because the result is a permutation, no question can appear twice."));
const fyMin = Math.min(...Object.values(fyCounts)), fyMax = Math.max(...Object.values(fyCounts));
const srt = Object.entries(sortCounts).sort((a, b) => b[1] - a[1]);
add(P("**Evaluation.** Re-drawing duplicate random indexes gets slower as the session fills. The shortcut `sort(() => Math.random() - 0.5)` is biased: in my experiment (tools/compare_shuffles.js, 60,000 shuffles of [1, 2, 3]) it gave the order " + srt[0][0] + " " + srt[0][1].toLocaleString("en") + " times and " + srt[srt.length - 1][0] + " only " + srt[srt.length - 1][1].toLocaleString("en") + " times, while Fisher–Yates gave every order " + fyMin.toLocaleString("en") + "–" + fyMax.toLocaleString("en") + " times. Shuffling a copy keeps the bank intact for the next session (CfS 8). `Math.random()` cannot be seeded, so the tests check properties (no repeats, even distribution) rather than fixed orders."));
add(P("**Testing.** S9–S14 and F3–F5. In S10 each of the six orders appeared " + Math.min(...s10).toLocaleString("en") + "–" + Math.max(...s10).toLocaleString("en") + " times."));

// Technique 3
add(H2("Technique 3 — Weighted scoring with a lookup table (CfS 3, 5)"));
const dpLine = lineOf("src/app.js", "const DIFFICULTY_POINTS");
add(code("src/app.js", dpLine, dpLine, "Code D3a — points per difficulty"));
const [haS] = functionRange("src/ui.js", "handleAnswer");
const ifCorrect = lineOf("src/ui.js", "if (isCorrect) {", haS);
add(code("src/ui.js", haS, ifCorrect + 6, "Code D3b — handleAnswer(), scoring part", [haS + 11, ifCorrect - 2]));
const [gmS, gmE] = functionRange("src/session.js", "getMaxScore");
add(P("**Technique.** The points are kept in one lookup object, `DIFFICULTY_POINTS`, keyed by the difficulty number 1–3. `handleAnswer()` adds the points, updates `diffStats` and records the answer; the `answered` flag lets it run only once per question. `getMaxScore()` (session.js, lines " + gmS + "–" + gmE + ") sums the points of the questions actually answered."));
add(P("**Evaluation.** Nested conditionals would also work, but the lookup table keeps the rule in one line and works on the number, not on the translated label (“Easy” or “Lengvas”). Points are whole numbers, so the total cannot contain rounding errors (CfS 5); only the percentage is rounded. Without the `answered` flag a double click would score twice."));
add(P("**Testing.** S15–S17, S24–S26, F6 and F9 (60/60 and 30/60, as calculated by hand)."));

// Technique 4
add(H2("Technique 4 — Event-driven interface and keyboard control (CfS 4, Accessibility)"));
const kdS = lineOf("src/app.js", 'document.addEventListener("keydown"');
add(code("src/app.js", kdS, kdS + 28, "Code D4 — the single keydown listener"));
add(P("**Technique.** Every answer, clicked or typed, goes through `handleAnswer()`. One keydown listener on the document (Code D4) maps A–D to options 1–4 and Enter or Space to the next question."));
add(P("**Evaluation.** A document listener survives the buttons being rebuilt for each question, and mouse and keyboard call the same function, so they cannot disagree. Line " + L.keyScreen + " ignores keys on other screens, line " + L.keyExists + " ignores options that a question does not have, and line " + L.keyEnter + " ignores Enter until the question is answered, so feedback cannot be skipped (CfS 4). Two weaknesses were fixed late: the key hint appeared only on the start screen (F15 failed), and option text was inserted with innerHTML, so a user's own CSV could inject HTML; it is now set with textContent."));
add(P("**Testing.** S18–S20, F7, F8, F15 and F17 (a whole session by keyboard only)."));

// Technique 5
add(H2("Technique 5 — Timestamp-based timer (CfS 6)"));
const [stS] = functionRange("src/session.js", "startTimer");
const [, spE] = functionRange("src/session.js", "stopTimer");
add(code("src/session.js", stS, spE, "Code D5 — startTimer() and stopTimer()"));
add(P("**Technique.** `startTimer()` stores `Date.now()`; `stopTimer()` subtracts it at the end. `setInterval` only refreshes the clock on screen."));
add(P("**Evaluation.** Counting `setInterval` ticks would drift, because browsers delay timers in busy or background tabs [6]; subtracting timestamps does not. `Math.floor` rounds down, so the time can be up to one second short instead of the nearest second."));
add(P("**Testing.** In F10 the app showed " + f10[1] + " while the test script measured " + f10[2] + " s; S21–S23 test the formatting and stopping a timer that never started."));

// Technique 6
add(H2("Technique 6 — Local history and “Practise my mistakes” (CfS 9)"));
const [gwS, gwE] = functionRange("src/storage.js", "getWeakQuestions");
add(code("src/storage.js", gwS, gwE, "Code D6 — getWeakQuestions()"));
add(P("**Technique.** Each session with at least one answer is stored as one JSON record (Table C3) under a key per profile. `getWeakQuestions()` derives statistics per question from the stored sessions with map, filter and a two-key sort (Code D6, Figure C14); `buildMistakePool()` keeps those present in the loaded bank, and up to 30 of them form a “Practise my mistakes” session."));
add(P("**Evaluation.** A server database would allow several devices but needs accounts and sends answers off the device; IndexedDB's asynchronous API is more than these small records need. localStorage, however, belongs to one browser and is erased with the site data, so Export and Import write and merge a JSON backup without duplicating session ids. Statistics are recalculated from the sessions, so they cannot disagree with them. Reads and writes use try/catch, and when storage is full `saveHistory()` keeps the newest half until it fits (Figure C15)."));
add(P("**Testing.** S27–S31 and F20 (the drill held exactly the ten questions missed before)."));

// Technique 7
add(H2("Technique 7 — Own question bank with own pictures (CfS 10)"));
const [riS, riE] = functionRange("src/bank.js", "resolveImageSrc");
add(code("src/bank.js", riS, riE, "Code D7 — resolveImageSrc()"));
add(P("**Technique and evaluation.** Selected images become blob URLs in a Map keyed by file name, and `resolveImageSrc()` chooses between an https:// link, the assets folder and these URLs. A user's bank never falls back to assets/, where 5.jpg would show a picture of a different question; a missing picture is reported instead (F21). For the same reason every record stores its bank, and statistics are kept apart by bank."));

// Testing
add(H2("Testing: deployment and effectiveness"));
add(P("The structural tests are in tests/test.html, which loads the real application in a frame and calls its functions. tests/run_tests.js serves the project over http, runs that page and then the functional tests in " + browser + ", and writes tests/results.json. In the final run " + passS + " of " + results.structural.length + " structural and " + passF + " of " + results.functional.length + " functional tests passed (Tables D2 and D3). The test suite was written with the help of an AI tool (see the acknowledgement)."));
add(P("The strategy was effective: it exposed three defects that normal use had not shown, all now fixed: S4 (escaped quotes), F15 (key hint missing on the quiz screen) and F24 (offline, Tailwind CSS could not load from its CDN, so all four screens appeared at once; the stylesheet is now built into css/styles.css). All three tests fail on commit 12a16ba and pass now (tests/results_before_fix.txt), which shows they detect what they claim to. Extreme and invalid data were the most productive, and randomness was tested statistically because one run proves nothing. Its limits: one browser engine on a Linux computer rather than a school laptop, usability measured through the interface rather than with users, and no automatic test of a failed bank download or a file-read error."));
add(table(["No.", "Function", "Type", "Actual result", "Result"], results.structural.slice().sort((a, b) => +a.id.slice(1) - +b.id.slice(1)).map(r => [r.id, r.fn, r.type, r.actual, r.pass ? "Pass" : "Fail"]), [6, 20, 9, 56, 9]));
add(caption("Table D2 — Structural test results (" + results.date.slice(0, 10) + ", " + browser + ")"));
add(table(["No.", "Criterion", "Actual result", "Result"], results.functional.slice().sort((a, b) => +a.id.slice(1) - +b.id.slice(1)).map(r => [r.id, r.criterion, r.actual, r.pass ? "Pass" : "Fail"]), [6, 16, 69, 9]));
add(caption("Table D3 — Functional test results (" + results.date.slice(0, 10) + ", " + browser + ")"));

// ---------------- Criterion E ----------------
add(H1("Criterion E: Evaluation"));
add(table(["Criterion", "Extent met", "Evidence and evaluation"], [
    ["1 CSV import", "Met", "F1, F2, F16: counts reported; invalid rows skipped. An unclosed quote is not located for the user."],
    ["2 Session", "Met", "F3–F5: 30 unique questions; 10 when only 10 exist; first five questions differed between two sessions."],
    ["3 Weighted scoring", "Met", "F6: Easy +1, Medium +2, Hard +3, label shown."],
    ["4 Feedback", "Met", "F7, F8: red/green marking, options locked, explanation shown."],
    ["5 Accurate score", "Met", "F9 matched hand calculation (60/60, 30/60); S24 42/60 = 70 %."],
    ["6 Timer", "Partly met", "F10 within 1 s of an independent measurement, but Math.floor rounds down instead of to the nearest second."],
    ["7 Results", "Met", "F12, F23: all required rows; a session ended early is labelled and scored on the answered questions."],
    ["8 Restart", "Met", "F13: new session, counters 0, timer 0:00, no reload."],
    ["9 History and mistakes", "Met", "F20, S27–S31: history saved; drill holds exactly the missed questions; backup import has no duplicates."],
    ["10 Own bank", "Met", "F21: own pictures shown; missing picture named."],
    ["Performance", "Met", "F14: " + loadMs + " ms load, " + slowMs + " ms per answer, on a fast computer; not yet measured on a school laptop."],
    ["Usability", "Met", "F15, F22: one click to start; hints always visible; Lithuanian interface and bank."],
    ["Reliability", "Met", "F16, F24, S28: bad files and corrupted storage handled; works offline after the fix."],
    ["Accessibility", "Met", "F17: whole session by keyboard."],
    ["Portability", "Partly met", "Shown only in Chromium on Linux; Chrome and Edge on Windows still to be checked."],
    ["Maintainability", "Met", "F19: an edited CSV question appeared with no source file changed."],
], [22, 14, 64]));
add(caption("Table E1 — Extent to which the success criteria were met"));
add(P("Nine of the ten functional criteria are fully met. The timer is met only within a tolerance: F10 was within one second of an independent measurement, but `Math.floor` rounds down rather than to the nearest second. Portability is partly met, because the product has run only in Chromium on Linux, and the performance margins (" + loadMs + " ms against 2,000 ms) were measured on a fast computer, not a school laptop. Reliability is the strongest result: testing found three defects, one of which made the product unusable offline, and all were fixed."));
add(H2("Improvements"));
add(P("**1. Mock-exam mode.** Practice sessions give feedback after every answer, which helps learning but is unlike the real test, which allows one minute per question and requires 80 % correct answers [2]. A mode that delays feedback to the end and applies that time limit and pass mark would show whether the learner is ready. It can reuse `startSession()` and `showResults()`, with a flag in `handleAnswer()` to delay feedback."));
add(P("**2. Topics.** The problem scenario mentions weak areas, but questions are classified only by difficulty and `getWeakQuestions()` works per question. A topic column in the CSV (for example signs, priority, speed) would let the results and the history group mistakes by topic, which tells the learner what to revise instead of which single questions to repeat."));
add(P("**3. Timer rounding.** Using `Math.round` instead of `Math.floor` in `stopTimer()` would meet CfS 6 exactly."));
add(P("**4. Clearer messages.** “1 images not found” (Figure C8) uses one plural form for every number, and an unclosed quote is not located. Choosing the plural form in i18n.js (Lithuanian needs three) and reporting the line of an unclosed quote would let a non-programmer correct a file without help."));

// ---------------- References & acknowledgement ----------------
add(H1("References"));
[
    "[1] Regitra. “Atnaujinami teorijos egzamino klausimai” (news). https://www.regitra.lt/naujienos/atnaujinami-teorijos-egzamino-klausimai/ (accessed 8 October 2026).",
    "[2] RoboKET. “Regitra teorijos egzaminas – temos, struktūra ir reikalavimai”. https://roboket.lt/ket/regitra-teorijos-egzaminas (accessed 8 October 2026).",
    "[3] Shafranovich, Y. (2005). RFC 4180: Common Format and MIME Type for Comma-Separated Values (CSV) Files. IETF. https://www.rfc-editor.org/rfc/rfc4180",
    "[4] Knuth, D. E. (1997). The Art of Computer Programming, Vol. 2: Seminumerical Algorithms, 3rd ed., section 3.4.2 (Algorithm P). Addison-Wesley.",
    "[5] PapaParse. https://www.papaparse.com (accessed 8 October 2026).",
    "[6] MDN Web Docs. “Window: setTimeout() method — Reasons for delays longer than specified”. https://developer.mozilla.org/en-US/docs/Web/API/Window/setTimeout (accessed 8 October 2026).",
    "[7] MDN Web Docs. “Window: localStorage property” and “FileReader”. https://developer.mozilla.org (accessed 8 October 2026).",
    "[8] Tailwind CSS v3.4. https://v3.tailwindcss.com (used to build css/styles.css).",
    "[9] Playwright. https://playwright.dev (used to run the automated tests).",
    "[10] Source of the 221 questions, explanations and pictures in database/ and assets/: [TO COMPLETE — name the source of the questions and of each picture, or state that they are the author's own].",
].forEach(r => add(N(r)));
add(H2("Acknowledgement of the use of AI"));
add(N("[TO REVIEW AND COMPLETE BY THE CANDIDATE] Claude (Anthropic), an AI assistant, was used in October 2026 to check this report against the code, to write the automated tests (tests/), the test-data generator (tools/make_test_data.py) and the shuffle comparison (tools/compare_shuffles.js), to fix the three defects described in Criterion D, to generate the diagrams in docs/ia/, to record the demonstration video with tools/record_video.js, to draft the text of its commentary (tools/narration.json), which the candidate recorded in her own voice, and to draft the text of this report. Every statement about the product was checked against the source code and tests/results.json. [Add: any other AI use, e.g. for the English translation of the question bank (tools/translations/), with the prompts and dates.]"));
add(H2("Appendices (submitted separately)"));
add(N("Appendix A — Full source code with line numbers (IA_Appendix_A_Source_Code.docx). Appendix B — Test code, test data and full results (tests/). Video — IA_video_Driving_Theory_Practice.mp4: every success criterion named and then shown working, with examples of structural and functional testing and a spoken commentary recorded by the candidate (screen recorded by tools/record_video.js; 3:16)."));

// ---------------- Cover ----------------
const cover = [
    new Paragraph({ spacing: { before: 2400, after: 200 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: "IB Diploma Programme — Computer Science", size: 26, color: "555555" })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Internal Assessment", size: 26, color: "555555" })] }),
    new Paragraph({ spacing: { before: 600, after: 200 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Driving Theory Practice", bold: true, size: 52 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "A revision tool for the Lithuanian driving theory test", size: 28 })] }),
    new Paragraph({ spacing: { before: 1200 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Candidate: Liepa Šveikauskaitė", size: 24 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Candidate code: [TO COMPLETE]     Session: [TO COMPLETE]", size: 24 })] }),
    new Paragraph({ spacing: { before: 600 }, alignment: AlignmentType.CENTER, children: [new TextRun({ text: "Word count: " + words, bold: true, size: 28 })] }),
    new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ text: "(excluding headings, tables, figures, captions, code, references and acknowledgements)", size: 18, color: "555555" })] }),
    new Paragraph({ spacing: { before: 1200 }, children: [new TextRun({ text: "Contents", bold: true, size: 24 })] }),
    ...["Criterion A: Problem specification", "Criterion B: Planning", "Criterion C: System overview", "Criterion D: Development", "Criterion E: Evaluation", "References, acknowledgement of AI use, appendices"].map(t => new Paragraph({ children: [new TextRun({ text: t, size: 22 })] })),
];

const doc = new Document({
    creator: "Liepa Šveikauskaitė",
    title: "Driving Theory Practice — IB Computer Science IA",
    styles: {
        default: { document: { run: { font: FONT, size: 21 } } },
        paragraphStyles: [
            { id: "Heading1", name: "Heading 1", basedOn: "Normal", next: "Normal", quickFormat: true,
              run: { size: 32, bold: true, font: FONT, color: "1F3A68" }, paragraph: { spacing: { after: 200 }, outlineLevel: 0 } },
            { id: "Heading2", name: "Heading 2", basedOn: "Normal", next: "Normal", quickFormat: true,
              run: { size: 25, bold: true, font: FONT, color: "1F3A68" }, paragraph: { spacing: { before: 240, after: 120 }, outlineLevel: 1, keepNext: true } },
            { id: "Heading3", name: "Heading 3", basedOn: "Normal", next: "Normal", quickFormat: true,
              run: { size: 22, bold: true, font: FONT }, paragraph: { spacing: { before: 160, after: 80 }, outlineLevel: 2, keepNext: true } },
        ]
    },
    sections: [{
        properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1134, bottom: 1134, left: 1134, right: 1134 } } },
        footers: { default: new Footer({ children: [new Paragraph({ alignment: AlignmentType.CENTER, children: [new TextRun({ children: [PageNumber.CURRENT], size: 18 })] })] }) },
        children: cover.concat(body)
    }]
});

Packer.toBuffer(doc).then(buf => {
    fs.writeFileSync(OUT, buf);
    console.log("Written " + OUT);
    console.log("Prose word count: " + words, JSON.stringify(sectionWords));
});
