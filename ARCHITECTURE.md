# CodeScale AI — Architecture

> Status legend: ✅ verified exists | 🟡 started, unverified | ⬜ planned (does NOT exist yet)
> Rule: a component is only marked ✅ after it has been run and checked.
> Last updated: 2026-10-27 (initial draft, before code inspection of local files)

---

## 1. What CodeScale AI Is (one paragraph, for judges)

CodeScale AI is a VS Code extension that finds code which works on small inputs but
becomes slow or unreliable on large inputs. It does NOT rely on an AI guess. It uses
**static analysis (Python `ast`) + real measurements (benchmarks) + tests** as evidence,
and uses an LLM (Groq) only to explain findings and draft code changes.

Core loop: **Detect → Recommend → Verify → Measure → Report**

Signature feature: **Scalability Crossover Finder** — benchmark two equivalent
implementations at growing input sizes and find where one becomes faster than the other.

---

## 2. Design Principles (and why — good interview answers)

| Principle | Why |
|---|---|
| Local-first | No cost, works offline, user code stays on their machine (privacy). |
| Evidence over AI opinion | Complexity, timings, test results are computed, not hallucinated. |
| Label everything: *estimated* vs *measured* vs *proven* | Judges and users must trust the numbers. |
| Never silently change user files | Always show a diff; user accepts or rejects. |
| Free tools only | Groq free tier, Render/Vercel/Neon free tiers, no paid APIs. |
| Modular, one responsibility per module | Easy to test, explain, and extend to other languages later. |
| Structured JSON between extension and engine | Easy to validate; engine can be swapped or moved to a server. |

---

## 3. High-Level Architecture

```
┌──────────────────────────── VS Code ─────────────────────────────┐
│                                                                  │
│  Extension Host (Node.js, JavaScript)                            │
│  ┌────────────┐  ┌──────────────┐  ┌───────────────────────┐     │
│  │ Commands & │  │ Webview Panel│  │ Editor integration    │     │
│  │ Activation │◄►│ (HTML/CSS/JS)│  │ decorations, diagnostics│    │
│  │ extension.js│ │ character +  │  │ WorkspaceEdit, diff   │     │
│  └─────┬──────┘  │ chat + dash  │  └───────────────────────┘     │
│        │         └──────────────┘                                │
│        │ message passing (postMessage)                           │
│  ┌─────▼──────────────┐      ┌──────────────────────┐            │
│  │ Service layer (JS) │─────►│ Groq client (HTTPS)  │──► Groq API│
│  │ - engineRunner     │      │ + Secret Storage key │            │
│  │ - groqService      │      └──────────────────────┘            │
│  │ - historyStore     │                                          │
│  └─────┬──────────────┘                                          │
└────────┼─────────────────────────────────────────────────────────┘
         │ spawn child process, JSON in / JSON out, timeout
┌────────▼─────────────────────────────────────────────────────────┐
│ Python Engine (Python 3.12, managed by uv)                       │
│  analyzer/  static analysis (ast)                                │
│  complexity/ Big-O estimation                                    │
│  benchmark/ timing + memory, sandboxed runner                    │
│  verify/    equivalence + property tests                         │
│  tests_gen/ edge-case & test recommendations                     │
│  security/  secret scanner                                       │
│  cleaner/   CSV data cleaning (pandas)                           │
│  repo/      multi-file scan                                      │
└──────────────────────────────────────────────────────────────────┘
```

### Free-cloud deployment (optional layer, built LAST)

A VS Code extension runs on the user's machine; it is not "hosted" on Render.
Free cloud is used for these parts:

| Piece | Where (free) | Purpose |
|---|---|---|
| Extension package (.vsix) | GitHub Releases / VS Code Marketplace (free to publish) | How judges install it |
| Landing page / demo dashboard | Vercel free tier | Public link for judges, screenshots, demo video |
| Optional backend (Groq proxy, shared reports) | Render free tier | Only if needed; sleeps when idle |
| Optional report storage | Neon Postgres free tier | Only if persistent cloud history is needed |

Decision rule: do NOT build the backend until the local extension works end to end.
Verify each free tier's current limits before deploying.

---

## 4. Planned Folder Structure

```
codescale-ai/
├── extension.js              ✅ activation, commands (exists, to be split later)
├── package.json              ✅ commands, activation, settings
├── src/                      ⬜ extension modules (created when extension.js grows)
│   ├── commands/
│   ├── services/ (groqService, engineRunner, historyStore)
│   ├── editor/   (decorations, diagnostics, applyEdit)
│   └── webview/  (panel provider)
├── media/                    ⬜ webview HTML/CSS/JS, character assets
├── analyzer/                 🟡 Python engine
│   ├── analyzer.py           🟡 AST analysis started
│   ├── sample.py             🟡 sample input file
│   ├── cli.py                ⬜ JSON-in/JSON-out entry point for the extension
│   └── ...modules per section 5
├── test/                     ✅ extension tests (scaffold), ⬜ Python tests (tests/ folder with pytest)
├── pyproject.toml            ⬜ MISSING — needed for uv, pytest, ruff
├── ARCHITECTURE.md, PROGRESS.md
└── .gitignore                ✅ ignores node_modules, .env
```

---

## 5. Module Responsibilities

| # | Module | Responsibility | Spec feature | Status |
|---|---|---|---|---|
| 1 | Activation & commands | Register commands, open panel | — | ✅ helloWorld, setApiKey, checkApiKey |
| 2 | Secret handling | Store key in VS Code Secret Storage | 14 | ✅ reported working |
| 3 | Groq service | Chat/explain/generate; validate responses; handle timeouts | 12 | 🟡 chat reported working |
| 4 | Static analyzer | Find functions, loops, nested loops, recursion, sort/search, list-membership | 1,10 | 🟡 started |
| 5 | Complexity estimator | Heuristic Big-O from AST + reasoning text | 4,5 | ⬜ |
| 6 | Benchmark runner | Time + memory at several sizes, repeats, warm-up, timeout, subprocess isolation | 8,9 | ⬜ |
| 7 | Crossover finder | Compare equivalent implementations across sizes, estimate crossover | 9,11 | ⬜ |
| 8 | Verifier | Compare original vs optimised (normal, edge, witness inputs; Hypothesis) | 7 | ⬜ |
| 9 | Worst-case finder | Candidate generators (sorted, reverse, duplicates…), pick slowest observed | 2 | ⬜ |
| 10 | Edge-case & test advisor | Suggest edge cases, run pytest, report discovered/passed/failed | 3,6 | ⬜ |
| 11 | Optimization recommender | Rule-based DSA suggestions (list→set, etc.) with before/after complexity | 10 | ⬜ |
| 12 | Editor integration | Highlight lines, diagnostics, diff preview, apply selected fixes | 1,12 | ⬜ |
| 13 | Webview UI | Character, chat, dashboard, feature views, back navigation | 4 | ⬜ |
| 14 | Secret scanner | Find hardcoded keys; mask values; never send to Groq | 14 | ⬜ |
| 15 | Data cleaner | CSV issues, preview, export new file | 13 | ⬜ |
| 16 | Repo analyzer | Multi-file scan, results by file/severity | 15 | ⬜ |
| 17 | History & reports | Local JSON in `.codescale/` (no keys, consent for source) | 16 | ⬜ |

---

## 6. Data Contracts (JSON between extension and engine)

Request:
```json
{ "action": "analyze_file", "file_path": "…", "options": { "timeout_s": 10 } }
```
Response:
```json
{
  "ok": true,
  "action": "analyze_file",
  "findings": [
    { "id": "F1", "line": 12, "category": "nested_loop",
      "severity": "medium", "evidence_type": "static",
      "message": "…", "suggestion": "…", "safe_autofix": false }
  ],
  "errors": []
}
```
`evidence_type` is always one of: `static` (estimated), `measured`, `tested`, `ai_suggested`.
The UI must show this label next to every result.

---

## 7. Safety Model

- Benchmarks/tests run in a **separate Python subprocess** with timeout, input-size cap, and memory cap where possible. Never `exec` user or AI code in the extension host.
- No destructive filesystem commands. Engine only reads the target file/folder.
- AI code changes → diff preview → user accepts (VS Code undo still works).
- Source code sent to Groq only after explicit consent; secrets never sent.
- API key only in Secret Storage; never in logs, reports, or Git.

---

## 8. Honesty Rules for Results (competition-critical)

1. Static estimate ≠ measured result ≠ proof. Label each.
2. "Worst case" from experiments = "worst observed", not proven.
3. Crossover = "observed" if measured in range, "predicted" if extrapolated (state assumptions).
4. Test count comes from pytest discovery, never invented.
5. Unimplemented features show "Not implemented yet", never fake data.
6. Passing tests = evidence of correctness, not proof.

---

## 9. Key Decisions Log

| Date | Decision | Reason |
|---|---|---|
| 2026-10-27 | Extension in JavaScript (matches existing repo) | Already scaffolded; avoids rewrite. |
| 2026-10-27 | Python engine via child process + JSON | Python `ast` is ideal for Python analysis; simple to test alone. |
| 2026-10-27 | Groq `openai/gpt-oss-120b` | Already configured; verify availability before changing. |
| 2026-10-27 | Backend deferred | Local-first is simpler, free, private. |
