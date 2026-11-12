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
- **Last updated:** 2026-11-12
- **Last commit:** 690e22b "Phase 4 final: history fallback storage, Run Tests folder picker, fast demo file, launch config, PROGRESS.md"
- **How the user wants to work:** guided steps, complete replacement files (not find-and-replace), exact PowerShell commands one per line.

---

## Verified State (2026-11-12)

### Python side
- ✅ `uv` installed; `pyproject.toml` + `uv.lock` committed; pytest, ruff as dev dependencies
- ✅ `analyzer/analyzer.py`, `complexity.py`, `benchmark.py`, `correctness.py`, `crossover.py`, `dsa_advisor.py`, `test_advisor.py`, `worst_case.py`, `phase2_cli.py`, `__init__.py`, `demo_phase2.py`
- ✅ `analyzer/dsa_advisor.py` now returns `function` and `line` on each recommendation (B19 fixed)
- ✅ `analyzer/secret_scanner.py` — regex secret scanner, values always masked
- ✅ `analyzer/phase4.py` — `find_worst_case`, `compare_implementations`, `run_tests`
- ✅ `analyzer/phase2_cli.py` — new operations: `find_worst_case`, `compare_implementations`, `run_tests`, `scan_secrets`
- ✅ `analyzer/demo_phase2_fast.py` — O(n) version of `unique`, used to test Verify and Crossover
- ✅ Tests: 34 passed (`tests/test_analyzer.py` 19, `tests/test_complexity.py` 9, `tests/test_phase4.py` 6)
- ✅ `uv run ruff check` passes (BLE001, TRY004 ignored globally and FURB192 for `demo_phase2.py` in `pyproject.toml`, each with a reason)

### Extension side
- ✅ `npm run lint` clean
- ✅ Earlier commands: Test Groq Connection, Analyze Current File, Suggest Tests, Suggest Data Structures, Benchmark Function, chat Analysis Tools panel (4 buttons)
- ✅ **Scan for Secrets** — 0 findings on demo file
- ✅ **Run Tests** — real pytest counts: discovered 34, passed 34 (project folder chosen via dialog)
- ✅ **Find Worst-Case Input** — `unique()` size 2000: slowest observed zigzag 25.4 ms, fastest all_equal 0.04 ms
- ✅ **Verify Optimized Version** — matched on `unique`, caught a real mismatch on `kth_values`
- ✅ **Find Crossover Between Two Versions** — `unique` original vs fast: candidate faster at all 5 sizes, 2x at n=100 up to 118x at n=5000, "no crossover observed"
- ✅ **Optimize with AI (Diff Preview)** — Groq proposal shown in side-by-side diff; "Save as Copy" path tested; Verify then caught the AI's `kth_values` change (duplicates: first index vs last index)
- ✅ **Show History** and **Export Report** — history saved in VS Code global storage when no folder is open (workspace `.codescale/` when a folder is open)
- 🟡 Optimize with AI "Apply Changes" and "Discard" paths — written, not run
- 🟡 Secret guard inside `askAI` (blocks Groq calls containing secrets) — written; passes with a clean file, NOT tested with a file that contains a fake key
- 🟡 Find Worst-Case Input timeout handling and Crossover failure rows — written, not triggered
- 🟡 "Inspect Code" button in chat panel — not re-tested after Phase 3
- 🟡 History is recorded from command palette runs and the chat panel buttons; panel recording not individually checked

---

## Known Bugs / Gaps

| # | Where | Issue | Status |
|---|---|---|---|
| B1 | package.json / extension.js | `codescale-ai.editCurrentFile` declared but never registered | ✅ Fixed |
| B2 | extension.js | Consent before sending to Groq | 🟡 Consent modal exists; secret guard added in `askAI` (not tested with a real secret) |
| B3 | extension.js | Chat flow "Preview" overwrites with WorkspaceEdit, not a diff. (Optimize with AI uses a real diff.) | Partial |
| B4 | extension.js | Intent guessed from prompt with regexes | Open |
| B5 | extension.js | HTML in webview/chat.html; script still one file | Partial (verify.js, phase4.js, history.js split out) |
| B6 | extension.js | "extension activated" popup on every start | ✅ Fixed |
| B7 | package.json | `engines.vscode` is ^1.140.0 (older VS Code can't install) | Open |
| B8 | analyzer.py | No line-level findings | ✅ Fixed |
| B9 | analyzer.py | `x in list` / `.index()` / `.count()` in loops not flagged | ✅ Fixed |
| B10 | analyzer.py | Comprehensions not counted as loops; `for x in sorted(...)` header ignored; `self.method()` recursion missed | Open |
| B11 | analyzer.py | No unused imports/variables or redundant-computation checks | Open |
| B12 | analyzer.py | Reads only from disk (no stdin), so unsaved text cannot be analysed | Open |
| B13 | sample.py | Samples inside `"""` strings, never analysed | Open (low priority) |
| B14 | npm | 3 low-severity vulnerabilities reported by npm | Open |
| B15 | analyzer.py | Two note strings run words together | Open (cosmetic) |
| B16 | extension.js | Chat panel only picks a target when opened | Open |
| B17 | extension.js | Chat flow cuts large files to 30,000 chars; reply replaces WHOLE file | Open |
| B18 | extension.js | "Working on your request..." re-enables Send early; `explicitFile` regex can pick wrong name | Open |
| B19 | dsa_advisor.py | Missing `function` field → "Unknown function" | ✅ Fixed |
| B20 | phase4.py | Worst-case and Crossover only work for functions that take ONE list of integers (benchmark.py passes a single argument) | Open (design limit) |
| B21 | phase4.js | Phase 4 tools exist only in the Command Palette; no buttons in the chat Analysis Tools panel (needs `webview/chat.html`) | Open |
| B22 | optimize flow | AI can change behaviour subtly (seen on `kth_values`); always Save as Copy, then Verify before applying | By design, documented |

---

## Roadmap

### Phase 1 — Make the base solid ✅ COMPLETE
### Phase 2 — Core evidence engine ✅ COMPLETE
### Phase 3 — Interface ✅ COMPLETE

### Phase 4 — Remaining features ✅ COMPLETE (2026-11-12)
Feature numbers follow the module table in ARCHITECTURE.md.
- [x] B19 fix (`function` and `line` in DSA recommendations)
- [x] Verify command (`verify.js`)
- [x] Feature 2: Worst-case input finder
- [x] Feature 3: Edge-case advisor (Suggest Tests, done in Phase 2)
- [x] Feature 6: Run tests with real pytest counts
- [x] Feature 11: Crossover between two versions
- [x] Feature 12: AI optimization with diff preview, Save-as-Copy, then Verify
- [x] Feature 14: Secret scanner + guard before Groq
- [x] Feature 16: History and Export Report

### Phase 5 — Extras
- [ ] Feature 13 data cleaning · Feature 15 repo-wide analysis
- [ ] B21: chat panel buttons for Phase 4 tools (needs `webview/chat.html`)
- [ ] Remaining bugs: B2 test, B10, B11, B12, B7

### Phase 6 — Release (free cloud)
- [ ] `.vsix` on GitHub Releases · Vercel landing/demo page · optional Render backend / Neon · README with screenshots and judge walkthrough (include the `kth_values` demo: AI suggestion caught by Verify)

---

## Current Step

**Phase 4 complete and pushed** (commit 690e22b, 2026-11-12). Seven new commands verified in the Extension Host; 34 tests pass; ruff and lint clean.
Next: Phase 5, starting with chat panel buttons for the Phase 4 tools (paste `webview/chat.html` at the start of the next chat), then data cleaning and repo-wide analysis.

## Session Log

| Date | Done | Next |
|---|---|---|
| 2026-10-27 | Wrote docs; installed uv; pytest + ruff; fixed Test Groq and ESLint; analyzer detects list scans inside loops | Step 1.6 |
| 2026-11-03 to 2026-11-06 | Line-level findings; `analyzeCurrentFile`; Inspect Code wired; B1 fixed | Phase 2 |
| 2026-11-09 to 2026-11-10 | Phase 2 engine + commands; Phase 3 webview extraction, Analysis Tools panel, B6 fixed; commits 4e58a57, e1a2460 | Phase 4 |
| 2026-11-12 | B19 fixed (be0e38c); pushed missing Phase 2 engine files (437f6cb); Phase 4: verify, worst-case, crossover, run tests, secret scanner, AI diff preview, history/reports (b3e239c); ruff config; launch.json opens the project folder; final Phase 4 commit 690e22b | Phase 5 |

## Gotchas Found

- uv install needs a fresh terminal (or `$env:Path = "C:\Users\Sakshi\.local\bin;$env:Path"`) before `uv` is recognised.
- `Add-Content -Value ""` makes PowerShell prompt for input; pass a list with `@(...)` instead.
- Paste commands only into the terminal panel, not into an open editor file.
- `git diff` / `git log` may open a pager; press `q` to leave.
- Downloads folder is `D:\My Documents\Downloads` (not C:).
- reasoning model `openai/gpt-oss-120b` spends tokens thinking; very small `max_completion_tokens` gives empty replies.
- Hardlink warning from uv on D: drive is harmless (cache on C:).
- Git LF→CRLF warnings on Windows are harmless.
- `phase2_cli.py` must import every analyzer module explicitly; `analyzer/__init__.py` is required for `python -m analyzer.phase2_cli`.
- `test_advisor.py` returns `category`, `test`, `reason`; `benchmark.py` returns `median_seconds` and `peak_memory_bytes`.
- `webview/chat.html` uses `{{NONCE}}` and `{{CSP_SOURCE}}` placeholders; extension.js replaces them at runtime.
- Git showed `dsa_advisor.py` as "create mode" in the B19 commit: it had never been committed. Always check `git status --short` for `??` files after adding new modules.
- Extension Host: click inside the code before running commands, otherwise "Open a file in the editor first" appears. `.vscode/launch.json` opens the project folder automatically; Run Tests also has a "Choose another folder" option.
- History/report is stored in the workspace `.codescale/` folder when a folder is open, otherwise in VS Code's global storage.
- Never run `ruff --unsafe-fixes`: it would turn the intentional `sorted(nums)[0]` in `demo_phase2.py` into `min(nums)`.
- AI-optimized code can change behaviour (e.g. first vs last index of duplicates). Save as Copy, run Verify, then apply. `*.optimized*.py` and `.codescale/` are in `.gitignore`.