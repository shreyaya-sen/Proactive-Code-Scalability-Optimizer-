# CodeScale AI — PROGRESS.md

Paste this file (or the relevant section) at the top of every new chat.

> Legend: ✅ verified working | 🟡 reported done / read in code but NOT run | ⬜ not started
> Never mark ✅ until it was run and checked.

---

## Project Snapshot

- **Name:** CodeScale AI (extension id `codescale-ai`)
- **Repo:** https://github.com/shreyaya-sen/Proactive-Code-Scalability-Optimizer-
- **Local folder:** `D:\Capstone Project\codescale-ai`
- **Stack:** VS Code extension (JavaScript), Python 3.12 engine via `uv`, Groq `openai/gpt-oss-120b`
- **Goal:** International AI coding competition + capstone
- **Environment:** Windows 11, PowerShell (no `&&`), `uv run` for all Python. Click in the TERMINAL panel before pasting commands.
- **Last updated:** 2026-10-27
- **Last commit:** 611fc7f "Detect list membership and index/count scans inside loops"
- **How the user wants to work:** very small steps, one action at a time, wait for the result before the next step.

---

## Verified State (2026-10-27)

### Python side
- ✅ `uv` 0.13.6 installed (user PATH: `C:\Users\Sakshi\.local\bin`)
- ✅ `pyproject.toml` + `uv.lock` committed; pytest 9.1.1, ruff 0.17.3 as dev dependencies
- ✅ `analyzer/analyzer.py` runs and prints valid JSON
- ✅ `analyzer/analyzer.py` now flags `x in list` / `x not in list` and `.index()` / `.count()` inside loops as "linear scan inside loop" (O(n^2) candidate); skips literals and names assigned from set/dict/frozenset
- ✅ `tests/test_analyzer.py`: 15 passed
- ✅ `uv run ruff check --fix` passes (SIM102 ignored on purpose; `analyzer/sample.py` excluded on purpose)
- ✅ `.gitignore` covers node_modules, .env, .venv, __pycache__, .pytest_cache, .ruff_cache

### Extension side
- ✅ `CodeScale AI: Test Groq Connection` works (prints "Connected"; key, SDK import and model confirmed). Earlier "No response" was caused by a 50-token limit; fixed (500 + empty-reply check)
- ✅ ESLint runs (`npm run lint`) after adding the missing `globals` dev dependency
- 🟡 Commands registered in extension.js: helloWorld, setApiKey, checkApiKey (only checks a key is saved), testGroq, openChat (webview chat), readWorkspace
- 🟡 Chat can generate/edit/create files and clean CSV via Groq (not yet tested by us)
- 🟡 Secret Storage used for the API key (working, since Test Groq succeeds)

---

## Known Bugs / Gaps

| # | Where | Issue | Status |
|---|---|---|---|
| B1 | package.json / extension.js | `codescale-ai.editCurrentFile` declared but never registered | Open |
| B2 | extension.js | No consent before sending file/attachment text (up to 30,000 chars) to Groq | Open |
| B3 | extension.js | "Preview" is a text tab, then overwrites with `fs.writeFile`; not a diff, bypasses undo, can overwrite unsaved edits | Open |
| B4 | extension.js | Intent guessed from prompt with regexes | Open |
| B5 | extension.js | ~500 lines in one file, HTML embedded; webview has no CSP | Open |
| B6 | extension.js | "extension activated" popup on every start | Open |
| B7 | package.json | `engines.vscode` is ^1.140.0 (older VS Code can't install) | Open |
| B8 | analyzer.py | No line-level findings (only function start line) | **Next** |
| B9 | analyzer.py | `x in list` / `.index()` / `.count()` in loops not flagged | ✅ Fixed (611fc7f) |
| B10 | analyzer.py | Comprehensions not counted as loops; `for x in sorted(...)` header ignored; `self.method()` recursion missed | Open |
| B11 | analyzer.py | No unused imports/variables or redundant-computation checks | Open |
| B12 | analyzer.py | Output lacks `findings`, `severity`, `evidence_type`; reads only from disk (no stdin) | Open |
| B13 | sample.py | `process` / `print_pairs` samples inside `"""` strings, never analysed | Open (low priority) |
| B14 | npm | 3 low-severity vulnerabilities reported by npm; do NOT run `npm audit fix --force`; review before release | Open |

---

## Roadmap (prioritised for the competition)

### Phase 1 — Make the base solid
- [x] 1.1 Verify existing work
- [x] 1.2 `pyproject.toml` (uv, pytest, ruff) + first Python tests
- [x] 1.3 ARCHITECTURE.md and PROGRESS.md in the repo
- [x] 1.4 Test Groq connection verified
- [x] 1.5 Detect `x in list` / `.index()` in loops (test-first)
- [ ] 1.6 Add line-level `findings` output (B8, B12) with tests  ← NEXT
- [ ] 1.7 Extension calls the engine and shows findings in the Output channel

### Phase 2 — Core evidence engine
- [ ] Feature 1 detection (+ B10, B11) · editor highlights/diagnostics
- [ ] Feature 8 benchmark runner (subprocess, timeout, multiple sizes)
- [ ] Feature 7 correctness verification
- [ ] Feature 10 DSA suggestions with before/after
- [ ] **Feature 9 Scalability Crossover Finder (signature feature)**
- [ ] Features 4/5 complexity estimates, labelled as estimates

### Phase 3 — Interface
- [ ] Split extension.js into modules (B5) + safe diff/accept flow (B3) + consent (B2)
- [ ] Webview shell (pastel theme, CSP), dashboard with 16 feature cards, feature views, graphs from real data
- [ ] Original CodeScale mascot (NOT a copy of the furu reference character): rounded, friendly, own design and colours, expressions driven by real results

### Phase 4 — Remaining features
- [ ] Features 2, 3, 6, 11, 12 (full), 14, 16

### Phase 5 — Extras
- [ ] Feature 13 data cleaning · Feature 15 repo-wide analysis

### Phase 6 — Release (free cloud)
- [ ] `.vsix` on GitHub Releases · Vercel landing/demo page · optional Render backend / Neon · README with screenshots and judge walkthrough

---

## Current Step

**Step 1.6:** make the analyzer report each problem as a finding with its own line number, severity, explanation and `evidence_type` (needed for highlighting lines in Feature 1).

## Session Log

| Date | Done | Next |
|---|---|---|
| 2026-10-27 | Wrote docs; read extension.js, package.json, analyzer.py; installed uv; pytest + ruff; fixed Test Groq (token limit) and ESLint (`globals`); analyzer now detects list scans inside loops; commits a14e10f, e01587a, 18355ae, 611fc7f | Step 1.6 line-level findings |

## Gotchas Found

- uv install needs a fresh terminal (or `$env:Path = "C:\Users\Sakshi\.local\bin;$env:Path"`) before `uv` is recognised.
- `Add-Content -Value ""` makes PowerShell prompt for input; pass a list with `@(...)` instead.
- Paste commands only into the terminal panel, not into an open editor file.
- `git diff` / `git log` may open a pager; press `q` to leave.
- Downloads folder is `D:\My Documents\Downloads` (not C:).
- reasoning model `openai/gpt-oss-120b` spends tokens thinking; very small `max_completion_tokens` gives empty replies.
- Hardlink warning from uv on D: drive is harmless (cache on C:).
- Git LF→CRLF warnings on Windows are harmless.
- Ruff SIM102 "unsafe fix" is a style hint; ignored on purpose.
