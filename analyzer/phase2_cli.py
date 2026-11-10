"""JSON interface for CodeScale AI Phase 2 tools."""

import json
import sys
from pathlib import Path

from analyzer.analyzer import CodeAnalyzer
from analyzer.benchmark import benchmark_function
from analyzer.correctness import verify_implementations
from analyzer.crossover import find_crossover
from analyzer.dsa_advisor import recommend_dsa
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