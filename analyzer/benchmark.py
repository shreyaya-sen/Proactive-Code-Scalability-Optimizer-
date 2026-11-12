"""Process-isolated benchmark runner for Python functions.

Input is JSON on stdin. The target function receives one JSON-compatible
argument. Benchmarking arbitrary Python code is not a security sandbox.
"""

import argparse
import json
import math
import subprocess
import sys
from pathlib import Path

CHILD_RUNNER = r'''
import importlib.util
import json
import statistics
import sys
import time
import tracemalloc

path, function_name, payload = sys.argv[1:4]
config = json.loads(payload)

spec = importlib.util.spec_from_file_location("codescale_target", path)
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)

function = getattr(module, function_name)
argument = config["input"]

for _ in range(config["warmups"]):
    function(argument)

samples = []
peak_memory = 0
last_result = None

for _ in range(config["repeats"]):
    tracemalloc.start()
    started = time.perf_counter()
    last_result = function(argument)
    elapsed = time.perf_counter() - started
    _, peak = tracemalloc.get_traced_memory()
    tracemalloc.stop()

    samples.append(elapsed)
    peak_memory = max(peak_memory, peak)

print(json.dumps({
    "samples_seconds": samples,
    "median_seconds": statistics.median(samples),
    "minimum_seconds": min(samples),
    "maximum_seconds": max(samples),
    "peak_memory_bytes": peak_memory,
    "result_type": type(last_result).__name__,
}))
'''


def _validate_config(config):
    warmups = config.get("warmups", 1)
    repeats = config.get("repeats", 5)
    timeout = config.get("timeout_seconds", 5)

    if not isinstance(warmups, int) or not 0 <= warmups <= 5:
        raise ValueError("warmups must be an integer from 0 to 5")

    if not isinstance(repeats, int) or not 1 <= repeats <= 20:
        raise ValueError("repeats must be an integer from 1 to 20")

    if (
        not isinstance(timeout, (int, float))
        or not math.isfinite(timeout)
        or not 0.1 <= timeout <= 30
    ):
        raise ValueError("timeout_seconds must be between 0.1 and 30")

    if "input" not in config:
        raise ValueError("input is required")

    return warmups, repeats, float(timeout)


def benchmark_function(
    file_path,
    function_name,
    input_value,
    warmups=1,
    repeats=5,
    timeout_seconds=5,
):
    path = Path(file_path).resolve()

    if not path.is_file():
        raise FileNotFoundError(f"Target file not found: {path}")

    if path.suffix.lower() != ".py":
        raise ValueError("Only Python files can be benchmarked")

    if not function_name.isidentifier():
        raise ValueError("Invalid function name")

    config = {
        "input": input_value,
        "warmups": warmups,
        "repeats": repeats,
    }

    payload = json.dumps(config)

    completed = subprocess.run(
        [
            sys.executable,
            "-c",
            CHILD_RUNNER,
            str(path),
            function_name,
            payload,
        ],
        capture_output=True,
        text=True,
        timeout=timeout_seconds,
        check=False,
    )

    if completed.returncode != 0:
        detail = (completed.stderr or "Target process failed").strip()
        raise RuntimeError(detail[-1500:])

    try:
        result = json.loads(completed.stdout)
    except json.JSONDecodeError as error:
        raise RuntimeError("Benchmark process returned invalid JSON") from error

    result.update({
        "function": function_name,
        "input_size": (
            len(input_value)
            if hasattr(input_value, "__len__")
            else None
        ),
        "warmups": warmups,
        "repeats": repeats,
        "timeout_seconds": timeout_seconds,
        "evidence_type": "empirical",
        "warning": (
            "Measurements are environment-dependent. Process isolation "
            "does not provide a security sandbox."
        ),
    })

    return result


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument("file")
    parser.add_argument("function")
    parser.add_argument("--input-json", required=True)
    parser.add_argument("--warmups", type=int, default=1)
    parser.add_argument("--repeats", type=int, default=5)
    parser.add_argument("--timeout", type=float, default=5)
    args = parser.parse_args()

    try:
        input_value = json.loads(args.input_json)
        _validate_config({
            "input": input_value,
            "warmups": args.warmups,
            "repeats": args.repeats,
            "timeout_seconds": args.timeout,
        })

        result = benchmark_function(
            args.file,
            args.function,
            input_value,
            args.warmups,
            args.repeats,
            args.timeout,
        )
        print(json.dumps({"status": "success", "result": result}))
        return 0

    except subprocess.TimeoutExpired:
        print(json.dumps({
            "status": "error",
            "error": "Benchmark timed out.",
        }))
        return 1
    except (ValueError, OSError, RuntimeError) as error:
        print(json.dumps({
            "status": "error",
            "error": str(error),
        }))
        return 1


if __name__ == "__main__":
    raise SystemExit(main())