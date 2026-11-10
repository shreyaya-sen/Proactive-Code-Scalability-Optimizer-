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
- **Last updated:** 2026-11-10
- **Last commit:** e1a2460 "Phase 3: extract webview HTML, add Analysis Tools panel, fix B6 popup"
- **How the user wants to work:** very small steps, one action at a time, wait for the result before the next step.

---

## Verified State (2026-11-10)

### Python side
- ✅ `uv` 0.13.6 installed (user PATH: `C:\Users\Sakshi\.local\bin`)
- ✅ `pyproject.toml` + `uv.lock` committed; pytest 9.1.1, ruff 0.17.3 as dev dependencies
- ✅ `analyzer/analyzer.py` runs and prints valid JSON
- ✅ `analyzer/analyzer.py` flags `x in list` / `x not in list` and `.index()` / `.count()` inside loops; nested loops; sort in loop
- ✅ `analyzer/complexity.py` — static complexity estimator with evidence and limitations
- ✅ `analyzer/benchmark.py` — process-isolated benchmark runner with tracemalloc; returns `median_seconds`, `peak_memory_bytes`
- ✅ `analyzer/correctness.py` — subprocess-based correctness verifier
- ✅ `analyzer/crossover.py` — observed performance crossover finder
- ✅ `analyzer/dsa_advisor.py` — DSA pattern recommendations from AST
- ✅ `analyzer/test_advisor.py` — boundary/edge-case test suggestions; returns `category`, `test`, `reason` per suggestion
- ✅ `analyzer/worst_case.py` — deterministic stress input generator
- ✅ `analyzer/phase2_cli.py` — JSON stdin/stdout interface for all Phase 2 ops; accepts both operation name aliases
- ✅ `analyzer/__init__.py` — package marker so `-m analyzer.phase2_cli` works
- ✅ `analyzer/demo_phase2.py` — demo file with unique / common / kth_values / positions (4 patterns)
- ✅ `tests/test_analyzer.py`: 19 passed
- ✅ `tests/test_complexity.py`: 9 passed
- ✅ Total: 28 passed (2026-11-10)
- ✅ `uv run ruff check --fix` passes

### Extension side
- ✅ `CodeScale AI: Test Groq Connection` works
- ✅ `npm run lint` passes (clean)
- ✅ `CodeScale AI: Analyze Current File` runs Python engine, shows findings + diagnostics
- ✅ `CodeScale AI: Suggest Tests` (command palette) — formatted readable output in Output channel
- ✅ `CodeScale AI: Suggest Data Structures` (command palette) — formatted readable output
- ✅ `CodeScale AI: Benchmark Function` (command palette) — shows median ms + peak memory KB
- ✅ `package.json` declares all 10 commands
- ✅ `webview/chat.html` — HTML extracted from extension.js; CSP/nonce injected at runtime
- ✅ **Analysis Tools panel** in chat UI — 4 buttons working in Extension Host:
  - ✅ 🧪 Suggest Tests — numbered list with category + test text + reason
  - ✅ 🗂️ Suggest Data Structures — shows issue + complexity impact
  - ✅ ⏱️ Benchmark Function — shows median ms + peak memory KB
  - ✅ 📊 Analyze Complexity — per-function time/space + findings
- ✅ B6 fixed — no more "extension activated!" popup on startup
- 🟡 "Inspect Code" button in chat panel — wired; still works (not re-tested after Phase 3)
- 🟡 Correctness verify and crossover ops wired in phase2_cli but no VS Code command yet
- 🟡 Suggest DSA "Unknown function (line ?)" — dsa_advisor returns function name in a different field; cosmetic, not blocking

---

## Known Bugs / Gaps

| # | Where | Issue | Status |
|---|---|---|---|
| B1 | package.json / extension.js | `codescale-ai.editCurrentFile` declared but never registered | ✅ Fixed |
| B2 | extension.js | No consent before sending file/attachment text to Groq | Open |
| B3 | extension.js | "Preview" overwrites with `fs.writeFile`; not a diff, bypasses undo | Open |
| B4 | extension.js | Intent guessed from prompt with regexes | Open |
| B5 | extension.js | HTML now in webview/chat.html; script still one file | Partial (HTML extracted) |
| B6 | extension.js | "extension activated" popup on every start | ✅ Fixed |
| B7 | package.json | `engines.vscode` is ^1.140.0 (older VS Code can't install) | Open |
| B8 | analyzer.py | No line-level findings (only function start line) | ✅ Fixed |
| B9 | analyzer.py | `x in list` / `.index()` / `.count()` in loops not flagged | ✅ Fixed |
| B10 | analyzer.py | Comprehensions not counted as loops; `for x in sorted(...)` header ignored; `self.method()` recursion missed | Open |
| B11 | analyzer.py | No unused imports/variables or redundant-computation checks | Open |
| B12 | analyzer.py | Still reads only from disk (no stdin), so unsaved text cannot be analysed | Open |
| B15 | analyzer.py | Two note strings run words together ("inside aloop", "functions,recursion") | Open (cosmetic) |
| B16 | extension.js | Chat panel only picks a target when opened; Inspect Code does not fall back to the open Python file | Open |
| B17 | extension.js | Large files cut to 30,000 chars before Groq; reply replaces WHOLE file (data-loss risk) | Open |
| B18 | extension.js | "Working on your request..." re-enables Send early; `explicitFile` regex can pick wrong name | Open |
| B19 | dsa_advisor.py | `recommend_dsa` result missing `function` field — panel shows "Unknown function" | Open (cosmetic) |
| B13 | sample.py | `process` / `print_pairs` samples inside `"""` strings, never analysed | Open (low priority) |
| B14 | npm | 3 low-severity vulnerabilities reported by npm | Open |

---

## Roadmap (prioritised for the competition)

### Phase 1 — Make the base solid ✅ COMPLETE
- [x] 1.1 Verify existing work
- [x] 1.2 `pyproject.toml` (uv, pytest, ruff) + first Python tests
- [x] 1.3 ARCHITECTURE.md and PROGRESS.md in the repo
- [x] 1.4 Test Groq connection verified
- [x] 1.5 Detect `x in list` / `.index()` in loops (test-first)
- [x] 1.6 Add line-level `findings` output (B8, B12) with tests
- [x] 1.7 Extension calls the engine and shows findings in the Output channel

### Phase 2 — Core evidence engine ✅ COMPLETE
- [x] Feature 8 benchmark runner (subprocess, timeout, multiple sizes)
- [x] Feature 7 correctness verification
- [x] Feature 10 DSA suggestions
- [x] Feature 9 Scalability Crossover Finder (wired in phase2_cli)
- [x] Features 4/5 complexity estimates (labelled as estimates)
- [x] VS Code commands: benchmarkFunction, suggestDSA, suggestTests — all verified

### Phase 3 — Interface ✅ COMPLETE
- [x] Remove activation popup (B6)
- [x] Extract HTML to `webview/chat.html`; inject nonce/CSP at runtime
- [x] Analysis Tools panel with 4 working buttons in the chat UI
- [x] Phase 2 results formatted as readable text (not raw JSON)

### Phase 4 — Remaining features
- [ ] Features 2, 3, 6, 11, 12 (full), 14, 16
- [ ] Fix B19: add `function` field to dsa_advisor recommendations
- [ ] Correctness verify + crossover VS Code commands

### Phase 5 — Extras
- [ ] Feature 13 data cleaning · Feature 15 repo-wide analysis

### Phase 6 — Release (free cloud)
- [ ] `.vsix` on GitHub Releases · Vercel landing/demo page · optional Render backend / Neon · README with screenshots and judge walkthrough

---

## Current Step

**Phase 3 complete** (commit e1a2460, 2026-11-10).
Analysis Tools panel live in chat UI; all 4 buttons verified; HTML extracted to webview/; B6 popup removed.
Next: Phase 4 — remaining features + cosmetic fixes.

## Session Log

| Date | Done | Next |
|---|---|---|
| 2026-10-27 | Wrote docs; read extension.js, package.json, analyzer.py; installed uv; pytest + ruff; fixed Test Groq (token limit) and ESLint (`globals`); analyzer now detects list scans inside loops; commits a14e10f, e01587a, 18355ae, 611fc7f | Step 1.6 line-level findings |
| 2026-11-03 to 2026-11-06 | Checkpoint commit 7fedcd4; line-level findings for nested loops (8883f5f) and sort in loop (de9cb71); added `demo_slow.py`; Step 1.7: `analyzeCurrentFile` command, Inspect Code wired, B1 fixed; lint clean; verified output on demo_slow.py | Phase 2 |
| 2026-11-09 to 2026-11-10 | Phase 2: benchmark.py, correctness.py, crossover.py, dsa_advisor.py, test_advisor.py, worst_case.py, phase2_cli.py, __init__.py, demo_phase2.py; package.json updated with 3 new commands; 28 tests pass; benchmarkFunction/suggestDSA/suggestTests verified in Extension Host; commit 4e58a57 | Phase 3 UI |
| 2026-11-10 | Phase 3: extracted webview/chat.html, added Analysis Tools panel (4 buttons), formatted Phase 2 results, removed activation popup (B6); all 4 buttons verified in Extension Host; commit e1a2460 | Phase 4 features |

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
- `phase2_cli.py` must import `dsa_advisor` explicitly — it was missing from the original version.
- `analyzer/__init__.py` is required for `python -m analyzer.phase2_cli` to work.
- `test_advisor.py` returns `category`, `test`, `reason` per suggestion (not `function`/`description`).
- `benchmark.py` returns `median_seconds` (not `mean_seconds`) and `peak_memory_bytes`.
- `webview/chat.html` uses `{{NONCE}}` and `{{CSP_SOURCE}}` as placeholders; extension.js replaces them at runtime with `.replace(/\{\{NONCE\}\}/g, nonce)`.