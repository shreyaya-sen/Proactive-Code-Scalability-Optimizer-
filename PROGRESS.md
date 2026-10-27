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
- **Environment:** Windows 11, PowerShell (no `&&`), `uv run` for all Python. Click in the TERMINAL panel before pasting commands (a paste once landed in sample.py by mistake).
- **Last updated:** 2026-10-27
- **Last commit:** a14e10f "Add uv project setup, pytest tests for analyzer, and ruff config"

---

## Verified State (2026-10-27)

### Python side
- ✅ `uv` 0.13.6 installed (user PATH: `C:\Users\Sakshi\.local\bin`; new terminals pick it up)
- ✅ `pyproject.toml` + `uv.lock` committed; pytest 9.1.1, ruff 0.17.3 as dev dependencies
- ✅ `analyzer/analyzer.py` runs and prints valid JSON (`uv run python analyzer\analyzer.py analyzer\sample.py`)
- ✅ `tests/test_analyzer.py`: 10 passed, 1 xfailed (known gap)
- ✅ `uv run ruff check --fix` passes (SIM102 ignored on purpose; `analyzer/sample.py` excluded on purpose)
- ✅ `.gitignore` covers node_modules, .env, .venv, __pycache__, .pytest_cache, .ruff_cache

### Extension side (read from code, NOT run yet)
- 🟡 Commands registered in extension.js: helloWorld, setApiKey, checkApiKey (only checks a key is saved), testGroq (real API call), openChat (webview chat), readWorkspace
- 🟡 Chat can generate/edit/create files and clean CSV via Groq (single-file and multi-file JSON mode)
- 🟡 Secret Storage used for the API key
- ⬜ NOT yet confirmed: "CodeScale AI: Test Groq Connection" result (run with F5)

---

## Known Bugs / Gaps

| # | Where | Issue | Plan |
|---|---|---|---|
| B1 | package.json / extension.js | `codescale-ai.editCurrentFile` declared in package.json but never registered → "command not found" | Remove entry or implement with real diff (during restructure) |
| B2 | extension.js | No consent before sending file/attachment text (up to 30,000 chars) to Groq | Add consent prompt |
| B3 | extension.js | "Preview" opens a text tab, then overwrites with `fs.writeFile`; not a diff, bypasses editor undo and can overwrite unsaved edits | Use diff view + `WorkspaceEdit` |
| B4 | extension.js | Intent guessed from prompt with regexes (folder/files/filename) | Replace with explicit UI choices |
| B5 | extension.js | ~500 lines in one file, HTML embedded; webview has no CSP | Split into modules before the dashboard |
| B6 | extension.js | "extension activated" popup on every start | Remove later |
| B7 | package.json | `engines.vscode` is ^1.140.0 (judges on older VS Code can't install) | Lower before release |
| B8 | analyzer.py | No line-level findings (only function start line) | Add `findings` list (Feature 1) |
| B9 | analyzer.py | `x in list`, `.index()`/`.count()` inside loops not flagged as quadratic (xfail test) | Fix next |
| B10 | analyzer.py | Comprehensions not counted as loops; `for x in sorted(...)` header ignored; `self.method()` recursion missed | Fix after B9 |
| B11 | analyzer.py | No unused imports/variables or redundant-computation checks | Feature 1 |
| B12 | analyzer.py | Output lacks `findings`, `severity`, `evidence_type` from ARCHITECTURE.md contract; reads only from disk (no stdin) | Add `cli.py` / stdin mode |
| B13 | sample.py | `process` and `print_pairs` samples are inside `"""` strings so they are never analysed | Move test samples into tests |

---

## Roadmap (prioritised for the competition)

### Phase 1 — Make the base solid
- [x] 1.1 Verify existing work (Python side done; extension Test Groq pending)
- [x] 1.2 `pyproject.toml` (uv, pytest, ruff) + first Python tests
- [ ] 1.3 Put ARCHITECTURE.md and PROGRESS.md into the repo root and commit
- [ ] 1.4 Run F5 → "Test Groq Connection" and record the result
- [ ] 1.5 Fix B9 (`x in list` / `.index()` in loops) test-first
- [ ] 1.6 Add line-level `findings` output (B8, B12) with tests
- [ ] 1.7 Extension calls engine and shows findings in the Output channel

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

**Step 1.3 → 1.5:** save docs in repo, verify Test Groq, then fix the `x in list` gap test-first.

## Session Log

| Date | Done | Next |
|---|---|---|
| 2026-10-27 | Wrote ARCHITECTURE.md, PROGRESS.md, Project Instructions. Read extension.js, package.json, analyzer.py. Installed uv, added pyproject.toml, pytest, ruff, 10 passing tests, committed a14e10f | Docs into repo; Test Groq; fix B9 |

## Gotchas Found

- uv install needs a fresh terminal (or `$env:Path = "C:\Users\Sakshi\.local\bin;$env:Path"`) before `uv` is recognised.
- `Add-Content -Value ""` makes PowerShell prompt for input; pass a list with `@(...)` instead.
- Paste commands only into the terminal panel, not into an open editor file.
- `git diff` / `git log` may open a pager; press `q` to leave.
- Hardlink warning from uv on D: drive is harmless (cache on C:).
- Git LF→CRLF warnings on Windows are harmless.
- Ruff SIM102 "unsafe fix" is a style hint; ignored on purpose.
