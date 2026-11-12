"""Phase 4 operations: worst-case search, comparison, and test runs."""

import random
import subprocess
import sys
import tempfile
from pathlib import Path
from xml.etree import ElementTree

from analyzer.benchmark import benchmark_function
from analyzer.crossover import find_crossover

PATTERNS = (
    "random",
    "sorted",
    "reverse_sorted",
    "all_equal",
    "few_unique",
    "zigzag",
)

MAX_SIZE = 100000
DEFAULT_COMPARE_SIZES = (100, 500, 1000, 2000, 5000)


def make_input(pattern, size, seed=12345):
    if pattern not in PATTERNS:
        raise ValueError(f"Unknown input pattern: {pattern}")

    rng = random.Random(seed)

    if pattern == "random":
        return [rng.randint(0, size) for _ in range(size)]

    if pattern == "sorted":
        return list(range(size))

    if pattern == "reverse_sorted":
        return list(range(size, 0, -1))

    if pattern == "all_equal":
        return [7] * size

    if pattern == "few_unique":
        return [rng.randint(0, 9) for _ in range(size)]

    return [i if i % 2 == 0 else size - i for i in range(size)]


def _check_size(size, minimum=1):
    if (
        not isinstance(size, int)
        or isinstance(size, bool)
        or not minimum <= size <= MAX_SIZE
    ):
        raise ValueError(
            f"Input size must be a whole number from {minimum} to {MAX_SIZE}"
        )


def _short(error):
    lines = str(error).strip().splitlines()
    return (lines[-1] if lines else "Failed")[:200]


def find_worst_case(
    file_path,
    function_name,
    size=2000,
    repeats=3,
    timeout_seconds=5,
):
    _check_size(size, minimum=10)

    measured = []
    failed = []

    for pattern in PATTERNS:
        data = make_input(pattern, size)

        try:
            result = benchmark_function(
                file_path,
                function_name,
                data,
                1,
                repeats,
                timeout_seconds,
            )
            measured.append({
                "pattern": pattern,
                "median_seconds": result["median_seconds"],
                "peak_memory_bytes": result["peak_memory_bytes"],
            })
        except subprocess.TimeoutExpired:
            failed.append({
                "pattern": pattern,
                "timed_out": True,
                "error": f"Timed out after {timeout_seconds} seconds",
            })
        except (RuntimeError, ValueError, OSError) as error:
            failed.append({
                "pattern": pattern,
                "timed_out": False,
                "error": _short(error),
            })

    timed_out = [item for item in failed if item["timed_out"]]

    if not measured and not timed_out:
        first = failed[0]["error"] if failed else "unknown error"
        return {
            "status": "error",
            "error": (
                "No input pattern could be benchmarked. The function must "
                f"accept one list of integers. First error: {first}"
            ),
        }

    ranked = sorted(
        measured,
        key=lambda item: item["median_seconds"],
        reverse=True,
    )

    if timed_out:
        slowest = {"pattern": timed_out[0]["pattern"], "timed_out": True}
    else:
        slowest = ranked[0]

    return {
        "status": "success",
        "function": function_name,
        "input_size": size,
        "slowest_observed": slowest,
        "results": ranked + failed,
        "evidence_type": "empirical",
        "label": (
            "Worst OBSERVED input among the tested patterns. This is not "
            "a proven worst case."
        ),
    }


def compare_implementations(
    first_file,
    second_file,
    function_name,
    sizes=None,
    repeats=3,
    timeout_seconds=5,
):
    sizes = list(sizes or DEFAULT_COMPARE_SIZES)

    if not 2 <= len(sizes) <= 6:
        raise ValueError("Provide 2 to 6 input sizes")

    for size in sizes:
        _check_size(size)

    first_results = []
    second_results = []
    failures = []

    for size in sorted(set(sizes)):
        data = make_input("random", size)

        try:
            first = benchmark_function(
                first_file, function_name, data, 1, repeats, timeout_seconds
            )
            second = benchmark_function(
                second_file, function_name, data, 1, repeats, timeout_seconds
            )
        except subprocess.TimeoutExpired:
            failures.append({
                "input_size": size,
                "error": f"Timed out after {timeout_seconds} seconds",
            })
            continue
        except (RuntimeError, ValueError, OSError) as error:
            failures.append({"input_size": size, "error": _short(error)})
            continue

        first_results.append(first)
        second_results.append(second)

    result = find_crossover(first_results, second_results)

    return {
        **result,
        "function": function_name,
        "first_file": str(first_file),
        "second_file": str(second_file),
        "failures": failures,
    }


def _summarize_junit(report_path, completed):
    root = ElementTree.parse(report_path).getroot()
    suites = [root] if root.tag == "testsuite" else root.findall("testsuite")

    def total(name):
        return sum(int(suite.get(name, 0)) for suite in suites)

    discovered = total("tests")
    failures = total("failures")
    errors = total("errors")
    skipped = total("skipped")
    passed = max(discovered - failures - errors - skipped, 0)

    failed_tests = []

    for case in root.iter("testcase"):
        for kind in ("failure", "error"):
            node = case.find(kind)

            if node is not None:
                failed_tests.append({
                    "test": f"{case.get('classname')}::{case.get('name')}",
                    "kind": kind,
                    "message": (node.get("message") or "")[:200],
                })

    return {
        "status": "success",
        "discovered": discovered,
        "passed": passed,
        "failed": failures,
        "errors": errors,
        "skipped": skipped,
        "failed_tests": failed_tests[:20],
        "exit_code": completed.returncode,
        "evidence_type": "tested",
        "limitation": (
            "Passing tests is evidence of correctness, not proof."
        ),
    }


def run_tests(path, timeout_seconds=100):
    target = Path(path).resolve()

    if not target.exists():
        raise FileNotFoundError(f"Not found: {target}")

    working = target if target.is_dir() else target.parent

    with tempfile.TemporaryDirectory() as folder:
        report = Path(folder) / "report.xml"

        try:
            completed = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "pytest",
                    str(target),
                    "-q",
                    "--tb=short",
                    "-p",
                    "no:cacheprovider",
                    f"--junitxml={report}",
                ],
                capture_output=True,
                text=True,
                timeout=timeout_seconds,
                cwd=str(working),
                check=False,
            )
        except subprocess.TimeoutExpired as error:
            raise RuntimeError(
                f"Tests did not finish within {timeout_seconds} seconds."
            ) from error

        if not report.exists():
            detail = (
                completed.stderr or completed.stdout or "pytest wrote no report"
            ).strip()
            raise RuntimeError(detail[-800:])

        return _summarize_junit(report, completed)