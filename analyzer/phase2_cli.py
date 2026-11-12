"""JSON interface for CodeScale AI Phase 2 and Phase 4 tools."""

import json
import sys
from pathlib import Path

from analyzer.analyzer import CodeAnalyzer
from analyzer.benchmark import benchmark_function
from analyzer.correctness import verify_implementations
from analyzer.crossover import find_crossover
from analyzer.dsa_advisor import recommend_dsa
from analyzer.phase4 import compare_implementations, find_worst_case, run_tests
from analyzer.secret_scanner import scan_text
from analyzer.test_advisor import advise_tests
from analyzer.worst_case import generate_suite, recommend_patterns


def execute(request):
    operation = request.get("operation")

    if operation == "analyze":
        file_path = Path(request["file"]).resolve()
        source = file_path.read_text(encoding="utf-8")
        return {
            "status": "success",
            "file": str(file_path),
            "functions": CodeAnalyzer(source).analyze(),
        }

    # "advise_tests" and "suggest_tests" both work (extension uses suggest_tests)
    if operation in ("advise_tests", "suggest_tests"):
        source = Path(request["file"]).read_text(encoding="utf-8")
        return advise_tests(source)

    if operation == "recommend_worst_cases":
        source = Path(request["file"]).read_text(encoding="utf-8")
        return {
            "status": "success",
            "recommendations": recommend_patterns(source),
        }

    if operation == "generate_worst_cases":
        return {
            "status": "success",
            "cases": generate_suite(
                request["pattern"],
                tuple(request.get("sizes", [10, 100, 1000])),
            ),
        }

    if operation == "benchmark":
        file_path = request["file"]
        function_name = request["function"]
        inputs = request.get("inputs")

        # Support single input (from extension's benchmarkFunction command)
        if inputs is None:
            input_value = request.get("input", [])
            inputs = [input_value]

        if not isinstance(inputs, list) or not inputs:
            raise ValueError("inputs must be a non-empty list")

        if len(inputs) > 10:
            raise ValueError("A maximum of 10 input sizes is allowed")

        results = []

        for input_value in inputs:
            results.append(
                benchmark_function(
                    file_path=file_path,
                    function_name=function_name,
                    input_value=input_value,
                    warmups=request.get("warmups", 1),
                    repeats=request.get("repeats", 5),
                    timeout_seconds=request.get("timeout_seconds", 5),
                )
            )

        return {
            "status": "success",
            "function": function_name,
            "measurements": results,
            "evidence_type": "empirical",
        }

    if operation == "crossover":
        return {
            "status": "success",
            **find_crossover(
                request["first_results"],
                request["second_results"],
            ),
        }

    if operation == "verify":
        return verify_implementations(
            original_file=request["original_file"],
            candidate_file=request["candidate_file"],
            function_name=request["function"],
            test_cases=request["test_cases"],
            timeout_seconds=request.get("timeout_seconds", 5),
        )

    # "recommend_dsa" and "suggest_dsa" both work (extension uses recommend_dsa)
    if operation in ("recommend_dsa", "suggest_dsa"):
        source = Path(request["file"]).read_text(encoding="utf-8")
        return recommend_dsa(source)

    # ---- Phase 4 operations ----

    if operation == "find_worst_case":
        return find_worst_case(
            file_path=request["file"],
            function_name=request["function"],
            size=request.get("size", 2000),
            repeats=request.get("repeats", 3),
            timeout_seconds=request.get("timeout_seconds", 5),
        )

    if operation == "compare_implementations":
        return compare_implementations(
            first_file=request["first_file"],
            second_file=request["second_file"],
            function_name=request["function"],
            sizes=request.get("sizes"),
            repeats=request.get("repeats", 3),
            timeout_seconds=request.get("timeout_seconds", 5),
        )

    if operation == "run_tests":
        return run_tests(
            request["path"],
            request.get("timeout_seconds", 100),
        )

    if operation == "scan_secrets":
        if "text" in request:
            text = request["text"]
        else:
            text = Path(request["file"]).read_text(encoding="utf-8")

        return scan_text(text)

    raise ValueError(f"Unsupported operation: {operation!r}")


def main():
    try:
        request = json.load(sys.stdin)

        if not isinstance(request, dict):
            raise ValueError("Request must be a JSON object")

        result = execute(request)
        print(json.dumps(result, ensure_ascii=False))
        return 0

    except Exception as error:
        print(json.dumps({
            "status": "error",
            "error": str(error),
        }, ensure_ascii=False))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())