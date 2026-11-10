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
- **Last commit:** 4e58a57 "Phase 2: fix package.json commands, phase2_cli aliases, add __init__.py and demo_phase2.py"
- **How the user wants to work:** very small steps, one action at a time, wait for the result before the next step.

---

## Verified State (2026-11-10)

### Python side
- ✅ `uv` 0.13.6 installed (user PATH: `C:\Users\Sakshi\.local\bin`)
- ✅ `pyproject.toml` + `uv.lock` committed; pytest 9.1.1, ruff 0.17.3 as dev dependencies
- ✅ `analyzer/analyzer.py` runs and prints valid JSON
- ✅ `analyzer/analyzer.py` flags `x in list` / `x not in list` and `.index()` / `.count()` inside loops; nested loops; sort in loop
- ✅ `analyzer/complexity.py` — static complexity estimator with evidence and limitations
- ✅ `analyzer/benchmark.py` — process-isolated benchmark runner with tracemalloc
- ✅ `analyzer/correctness.py` — subprocess-based correctness verifier
- ✅ `analyzer/crossover.py` — observed performance crossover finder
- ✅ `analyzer/dsa_advisor.py` — DSA pattern recommendations from AST
- ✅ `analyzer/test_advisor.py` — boundary/edge-case test suggestions from AST
- ✅ `analyzer/worst_case.py` — deterministic stress input generator
- ✅ `analyzer/phase2_cli.py` — JSON stdin/stdout interface for all Phase 2 ops; accepts both operation name aliases (suggest_tests / advise_tests, recommend_dsa / suggest_dsa)
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
- ✅ `CodeScale AI: Suggest Tests` — returns 7 suggestions for demo_phase2.py (verified in Extension Host)
- ✅ `CodeScale AI: Suggest Data Structures` — returns 1 recommendation for demo_phase2.py (verified)
- ✅ `CodeScale AI: Benchmark Function` — benchmarks a named function (verified on `unique`)
- ✅ `package.json` now declares all 10 commands including the 3 new Phase 2 ones
- 🟡 "Inspect Code" button in chat panel — wired; result text under button not re-confirmed after Phase 2
- 🟡 Correctness verify and crossover ops wired in phase2_cli but no VS Code command yet

---

## Known Bugs / Gaps

| # | Where | Issue | Status |
|---|---|---|---|
| B1 | package.json / extension.js | `codescale-ai.editCurrentFile` declared but never registered | ✅ Fixed |
| B2 | extension.js | No consent before sending file/attachment text to Groq | Open |
| B3 | extension.js | "Preview" overwrites with `fs.writeFile`; not a diff, bypasses undo | Open |
| B4 | extension.js | Intent guessed from prompt with regexes | Open |
| B5 | extension.js | ~500 lines in one file, HTML embedded; webview has no CSP | Open |
| B6 | extension.js | "extension activated" popup on every start | Open |
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

**Phase 2 complete** (commit 4e58a57, 2026-11-10).
All Phase 2 commands verified working in Extension Development Host.
Next: Phase 3 — UI improvements (safe diff/accept, CSP webview, dashboard).

## Session Log

| Date | Done | Next |
|---|---|---|
| 2026-10-27 | Wrote docs; read extension.js, package.json, analyzer.py; installed uv; pytest + ruff; fixed Test Groq (token limit) and ESLint (`globals`); analyzer now detects list scans inside loops; commits a14e10f, e01587a, 18355ae, 611fc7f | Step 1.6 line-level findings |
| 2026-11-03 to 2026-11-06 | Checkpoint commit 7fedcd4; line-level findings for nested loops (8883f5f) and sort in loop (de9cb71); added `demo_slow.py`; Step 1.7: `analyzeCurrentFile` command, Inspect Code wired, B1 fixed; lint clean; verified output on demo_slow.py | Phase 2 |
| 2026-11-09 to 2026-11-10 | Phase 2: benchmark.py, correctness.py, crossover.py, dsa_advisor.py, test_advisor.py, worst_case.py, phase2_cli.py, __init__.py, demo_phase2.py; package.json updated with 3 new commands; 28 tests pass; benchmarkFunction/suggestDSA/suggestTests verified in Extension Host; commit 4e58a57 | Phase 3 UI |

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