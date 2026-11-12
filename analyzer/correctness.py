"""Compare two Python function implementations on supplied test cases.

The compared code runs in subprocesses, not in a secure sandbox.
"""

import argparse
import json
import subprocess
import sys
from pathlib import Path

CHILD_RUNNER = r'''
import importlib.util
import json
import sys

path, function_name, input_payload = sys.argv[1:4]

spec = importlib.util.spec_from_file_location("codescale_candidate", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

function = getattr(module, function_name)
arguments = json.loads(input_payload)

if not isinstance(arguments, list):
    raise TypeError("Each test case must be a list of positional arguments")

result = function(*arguments)

try:
    encoded = json.dumps(result, sort_keys=True)
except TypeError as error:
    raise TypeError(
        "Function result must be JSON serializable for comparison"
    ) from error

print(encoded)
'''


def _run_case(file_path, function_name, arguments, timeout):
    completed = subprocess.run(
        [
            sys.executable,
            "-c",
            CHILD_RUNNER,
            str(Path(file_path).resolve()),
            function_name,
            json.dumps(arguments),
        ],
        capture_output=True,
        text=True,
        timeout=timeout,
        check=False,
    )

    if completed.returncode != 0:
        return {
            "status": "error",
            "error": (completed.stderr or "Execution failed")[-1200:],
        }

    try:
        return {
            "status": "success",
            "value": json.loads(completed.stdout),
        }
    except json.JSONDecodeError:
        return {
            "status": "error",
            "error": "Function returned a non-JSON result.",
        }


def verify_implementations(
    original_file,
    candidate_file,
    function_name,
    test_cases,
    timeout_seconds=5,
):
    if not isinstance(test_cases, list) or not test_cases:
        raise ValueError("At least one test case is required")

    if len(test_cases) > 100:
        raise ValueError("A maximum of 100 test cases is allowed")

    if not function_name.isidentifier():
        raise ValueError("Invalid function name")

    original_path = Path(original_file).resolve()
    candidate_path = Path(candidate_file).resolve()

    for path in (original_path, candidate_path):
        if not path.is_file() or path.suffix.lower() != ".py":
            raise ValueError(f"Invalid Python file: {path}")

    results = []
    passed = 0

    for index, arguments in enumerate(test_cases):
        if not isinstance(arguments, list):
            raise ValueError(
                f"Test case {index + 1} must be a list of positional arguments"
            )

        try:
            original = _run_case(
                original_path, function_name, arguments, timeout_seconds
            )
            candidate = _run_case(
                candidate_path, function_name, arguments, timeout_seconds
            )
        except subprocess.TimeoutExpired:
            results.append({
                "case": index + 1,
                "status": "timeout",
                "passed": False,
            })
            continue

        if original["status"] != "success":
            results.append({
                "case": index + 1,
                "status": "original_error",
                "passed": False,
                "details": original.get("error"),
            })
            continue

        if candidate["status"] != "success":
            results.append({
                "case": index + 1,
                "status": "candidate_error",
                "passed": False,
                "details": candidate.get("error"),
            })
            continue

        matched = original["value"] == candidate["value"]
        passed += int(matched)

        results.append({
            "case": index + 1,
            "status": "passed" if matched else "mismatch",
            "passed": matched,
            "original_result": original["value"],
            "candidate_result": candidate["value"],
        })

    return {
        "status": "success",
        "function": function_name,
        "total_cases": len(test_cases),
        "passed": passed,
        "failed": len(test_cases) - passed,
        "all_passed": passed == len(test_cases),
        "evidence_type": "empirical",
        "results": results,
        "limitation": (
            "Passing supplied test cases is not a proof of equivalence "
            "for all possible inputs."
        ),
        "security_warning": (
            "Subprocess execution is not a secure sandbox. Only compare "
            "code you trust."
        ),
    }


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("original")
    parser.add_argument("candidate")
    parser.add_argument("function")
    parser.add_argument("--cases-json", required=True)
    parser.add_argument("--timeout", type=float, default=5)
    args = parser.parse_args()

    try:
        cases = json.loads(args.cases_json)
        result = verify_implementations(
            args.original,
            args.candidate,
            args.function,
            cases,
            args.timeout,
        )
        print(json.dumps(result))
        return 0
    except (ValueError, OSError, subprocess.TimeoutExpired) as error:
        print(json.dumps({
            "status": "error",
            "error": str(error),
        }))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())