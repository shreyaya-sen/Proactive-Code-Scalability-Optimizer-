
from __future__ import annotations

import ast
import json
import sys
from pathlib import Path
from typing import Any

try:
    from analyzer.complexity import ComplexityEstimator
except ModuleNotFoundError:
    from complexity import ComplexityEstimator


class CodeAnalyzer:
    """AST-based, heuristic analyzer for Python function scalability."""

    def __init__(self, source: str):
        self.source = source
        self.lines = source.splitlines()
        self.tree = ast.parse(source)
        self.results: list[dict[str, Any]] = []
        self._finding_counter = 0
        self.complexity_estimator = ComplexityEstimator()

    def analyze(self) -> list[dict[str, Any]]:
        """Analyze every function and return one result per function."""
        self.results = []
        self._finding_counter = 0

        for node in ast.walk(self.tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                self.results.append(self.analyze_function(node))

        self.results.sort(key=lambda item: item["line"])
        return self.results

    def analyze_function(
        self, node: ast.FunctionDef | ast.AsyncFunctionDef
    ) -> dict[str, Any]:
        findings: list[dict[str, Any]] = []
        patterns: list[str] = []
        function_name = node.name

        def add_pattern(*values: str) -> None:
            for value in values:
                if value not in patterns:
                    patterns.append(value)

        def add_finding(
            target: ast.AST,
            category: str,
            severity: str,
            message: str,
            suggestion: str,
        ) -> None:
            line = getattr(target, "lineno", node.lineno)
            end_line = getattr(target, "end_lineno", line)

            if any(
                finding["line"] == line
                and finding["category"] == category
                for finding in findings
            ):
                return

            self._finding_counter += 1

            findings.append({
                "id": f"finding-{self._finding_counter}",
                "line": line,
                "end_line": end_line,
                "category": category,
                "severity": severity,
                "evidence_type": "static",
                "message": message,
                "suggestion": suggestion,
                "safe_autofix": False,
            })

        def is_loop(statement: ast.stmt) -> bool:
            return isinstance(
                statement,
                (ast.For, ast.AsyncFor, ast.While),
            )

        def walk_statements(
            statements: list[ast.stmt],
            depth: int = 0,
        ):
            """Walk statements while tracking loop nesting."""
            for statement in statements:
                yield statement, depth

                if is_loop(statement):
                    yield from walk_statements(
                        getattr(statement, "body", []),
                        depth + 1,
                    )
                    yield from walk_statements(
                        getattr(statement, "orelse", []),
                        depth,
                    )
                    continue

                for _, value in ast.iter_fields(statement):
                    if isinstance(value, list):
                        children = [
                            item for item in value
                            if isinstance(item, ast.stmt)
                        ]
                        if children:
                            yield from walk_statements(children, depth)

        def is_sort_call(call: ast.Call) -> bool:
            if isinstance(call.func, ast.Name):
                return call.func.id == "sorted"

            return (
                isinstance(call.func, ast.Attribute)
                and call.func.attr == "sort"
            )

        def is_index_or_count_call(call: ast.Call) -> bool:
            return (
                isinstance(call.func, ast.Attribute)
                and call.func.attr in {"index", "count"}
            )

        def is_logarithmic_while(statement: ast.While) -> bool:
            for child in ast.walk(statement):
                if isinstance(child, ast.AugAssign):
                    if isinstance(child.op, (ast.FloorDiv, ast.Div)):
                        return True

                if isinstance(child, ast.Assign):
                    if (
                        isinstance(child.value, ast.BinOp)
                        and isinstance(
                            child.value.op,
                            (ast.FloorDiv, ast.Div),
                        )
                    ):
                        return True

                if isinstance(child, ast.Call):
                    if (
                        isinstance(child.func, ast.Name)
                        and child.func.id in {"log", "log2", "log10"}
                    ):
                        return True

            return False

        def is_collection_growth(statement: ast.AST) -> bool:
            growth_methods = {
                "append",
                "extend",
                "add",
                "insert",
                "update",
                "setdefault",
            }

            for child in ast.walk(statement):
                if isinstance(child, ast.Call):
                    if (
                        isinstance(child.func, ast.Attribute)
                        and child.func.attr in growth_methods
                    ):
                        return True

                if isinstance(child, (ast.Assign, ast.AnnAssign)):
                    value = child.value
                    if isinstance(
                        value,
                        (
                            ast.List,
                            ast.Dict,
                            ast.Set,
                            ast.ListComp,
                            ast.DictComp,
                            ast.SetComp,
                        ),
                    ):
                        return True

            return False

        # Infer simple collection types.
        collection_types: dict[str, str] = {}

        for child in ast.walk(node):
            if isinstance(child, ast.Assign):
                value = child.value
                targets = child.targets
            elif isinstance(child, ast.AnnAssign):
                value = child.value
                targets = [child.target]
            else:
                continue

            if value is None:
                continue

            inferred_type: str | None = None

            if isinstance(value, (ast.List, ast.ListComp)):
                inferred_type = "list"
            elif isinstance(value, (ast.Set, ast.SetComp)):
                inferred_type = "set"
            elif isinstance(value, (ast.Dict, ast.DictComp)):
                inferred_type = "dict"
            elif isinstance(value, ast.Call) and isinstance(
                value.func, ast.Name
            ):
                if value.func.id in {"set", "frozenset"}:
                    inferred_type = "set"
                elif value.func.id == "dict":
                    inferred_type = "dict"
                elif value.func.id == "list":
                    inferred_type = "list"

            if inferred_type:
                for target in targets:
                    if isinstance(target, ast.Name):
                        collection_types[target.id] = inferred_type

        # Loop information.
        loop_nodes = [
            (statement, depth)
            for statement, depth in walk_statements(node.body)
            if is_loop(statement)
        ]

        loop_count = len(loop_nodes)
        maximum_loop_nesting = max(
            (depth + 1 for _, depth in loop_nodes),
            default=0,
        )

        nested_loops = [
            statement
            for statement, depth in loop_nodes
            if depth >= 1
        ]
        has_nested_loop = bool(nested_loops)

        top_level_loops = [
            statement
            for statement in node.body
            if is_loop(statement)
        ]
        has_sequential_loops = len(top_level_loops) > 1

        nodes_inside_loops: set[int] = set()

        for loop, _ in loop_nodes:
            nodes_inside_loops.update(
                id(child) for child in ast.walk(loop)
            )

        # Recursion.
        recursive_calls = [
            child
            for child in ast.walk(node)
            if (
                isinstance(child, ast.Call)
                and isinstance(child.func, ast.Name)
                and child.func.id == function_name
            )
        ]
        recursive = bool(recursive_calls)

        # Sorting.
        sort_calls = [
            child
            for child in ast.walk(node)
            if isinstance(child, ast.Call) and is_sort_call(child)
        ]
        sorting = bool(sort_calls)

        sort_inside_loop = [
            call for call in sort_calls
            if id(call) in nodes_inside_loops
        ]

        # Repeated index/count scans.
        repeated_scan_calls = [
            child
            for child in ast.walk(node)
            if (
                isinstance(child, ast.Call)
                and is_index_or_count_call(child)
                and id(child) in nodes_inside_loops
            )
        ]

        # Membership checks.
        membership_inside_loop: list[ast.Compare] = []
        membership_outside_loop: list[ast.Compare] = []

        for child in ast.walk(node):
            if not isinstance(child, ast.Compare):
                continue

            membership_pairs = [
                (operator, comparator)
                for operator, comparator in zip(
                    child.ops,
                    child.comparators,
                )
                if isinstance(operator, (ast.In, ast.NotIn))
            ]

            if not membership_pairs:
                continue

            is_literal_collection = any(
                isinstance(comparator, (ast.Tuple, ast.List, ast.Set))
                for _, comparator in membership_pairs
            )

            if is_literal_collection:
                continue

            collection_name: str | None = None

            for _, comparator in membership_pairs:
                if isinstance(comparator, ast.Name):
                    collection_name = comparator.id
                    break

            collection_type = (
                collection_types.get(collection_name)
                if collection_name
                else None
            )

            if id(child) in nodes_inside_loops:
                if collection_type not in {"set", "dict"}:
                    membership_inside_loop.append(child)
            else:
                membership_outside_loop.append(child)

        collection_growth = is_collection_growth(node)

        # While-loop classification.
        while_nodes = [
            statement
            for statement, _ in loop_nodes
            if isinstance(statement, ast.While)
        ]

        logarithmic_while_nodes = [
            statement
            for statement in while_nodes
            if is_logarithmic_while(statement)
        ]

        unknown_while_nodes = [
            statement
            for statement in while_nodes
            if statement not in logarithmic_while_nodes
        ]

        logarithmic_while = bool(logarithmic_while_nodes)
        unknown_while = bool(unknown_while_nodes)

        # Comprehension detection.
        comprehension_types = (
            ast.ListComp,
            ast.SetComp,
            ast.DictComp,
            ast.GeneratorExp,
        )

        comprehensions = [
            child
            for child in ast.walk(node)
            if isinstance(child, comprehension_types)
        ]

        has_comprehension = bool(comprehensions)

        has_nested_comprehension = any(
            any(
                isinstance(descendant, comprehension_types)
                for descendant in ast.walk(comprehension)
                if descendant is not comprehension
            )
            or len(comprehension.generators) > 1
            for comprehension in comprehensions
        )

        # Patterns.
        if loop_count:
            add_pattern("loop")

        if has_nested_loop:
            add_pattern("nested_loops", "nested loops")

        if has_sequential_loops:
            add_pattern(
                "sequential_loops",
                "multiple sequential loops",
            )

        if recursive:
            add_pattern("recursion")

        if logarithmic_while:
            add_pattern(
                "logarithmic_while_candidate",
                "potential logarithmic loop",
            )

        if unknown_while:
            add_pattern("while_loop")

        if membership_inside_loop:
            add_pattern(
                "membership_scan",
                "linear scan inside loop",
            )

        if membership_outside_loop:
            add_pattern(
                "membership_scan",
                "membership test",
            )

        if repeated_scan_calls:
            add_pattern(
                "repeated_index_or_count",
                "linear scan inside loop",
            )

        if sorting:
            add_pattern("sorting")

        if collection_growth:
            add_pattern("collection_growth")

        if has_comprehension:
            add_pattern("comprehension")

        if has_nested_comprehension:
            add_pattern("nested_comprehension")

        # Findings.
        if nested_loops:
            inner_loop = min(
                nested_loops,
                key=lambda item: getattr(item, "lineno", node.lineno),
            )
            add_finding(
                inner_loop,
                "nested_loops",
                "medium",
                "Nested loops were detected. Their combined iterations may grow rapidly as input size increases.",
                "Check whether the inner loop can be replaced with a set, dictionary, lookup table, or a more efficient algorithm.",
            )

        if membership_inside_loop:
            comparison = min(
                membership_inside_loop,
                key=lambda item: getattr(item, "lineno", node.lineno),
            )

            collection_name = None
            for operator, comparator in zip(
                comparison.ops,
                comparison.comparators,
            ):
                if isinstance(operator, (ast.In, ast.NotIn)):
                    if isinstance(comparator, ast.Name):
                        collection_name = comparator.id
                    break

            collection_type = (
                collection_types.get(collection_name)
                if collection_name
                else None
            )

            category = (
                "list_membership_in_loop"
                if collection_type == "list"
                else "membership_scan"
            )

            message = (
                f"A membership check against '{collection_name}' "
                "inside a loop may repeatedly scan the collection."
                if collection_name
                else
                "A membership check inside a loop may repeatedly "
                "scan a collection."
            )

            add_finding(
                comparison,
                category,
                "medium",
                message,
                "Consider using a set or dictionary for faster membership checks when ordering and duplicate requirements allow it.",
            )

        if repeated_scan_calls:
            call = min(
                repeated_scan_calls,
                key=lambda item: getattr(item, "lineno", node.lineno),
            )

            method_name = (
                ast.unparse(call.func)
                if hasattr(ast, "unparse")
                else "index() or count()"
            )

            add_finding(
                call,
                "repeated_search_in_loop",
                "medium",
                f"The {method_name} operation inside a loop may repeatedly scan a collection.",
                "Consider building a lookup dictionary or counting values in one pass.",
            )

        if sorting:
            for call in sort_calls:
                inside_loop = id(call) in nodes_inside_loops

                sort_operation = (
                    ast.unparse(call.func)
                    if hasattr(ast, "unparse")
                    else (
                        "sorted"
                        if isinstance(call.func, ast.Name)
                        else "sort"
                    )
                )

                add_finding(
                    call,
                    "sort_in_loop" if inside_loop else "sorting",
                    "medium" if inside_loop else "info",
                    (
                        f"The '{sort_operation}' operation inside a loop "
                        "may repeatedly sort collections, increasing "
                        "runtime significantly."
                        if inside_loop
                        else
                        f"The '{sort_operation}' operation was detected. "
                        "Sorting commonly requires O(n log n) time."
                    ),
                    "Check whether the entire collection needs to be sorted or whether a partial selection or single-pass solution is sufficient.",
                )

        if recursive:
            add_finding(
                recursive_calls[0],
                "recursion",
                "medium",
                "A recursive call to the current function was detected.",
                "Check recursion depth, repeated subproblems, and whether memoization or an iterative implementation would improve scalability.",
            )

        for while_node in logarithmic_while_nodes:
            add_finding(
                while_node,
                "while_loop",
                "info",
                "The while loop contains a division-based update that may reduce the search space logarithmically.",
                "Verify that the loop variable is consistently reduced and that the termination condition is correct.",
            )

        for while_node in unknown_while_nodes:
            add_finding(
                while_node,
                "while_loop",
                "medium",
                "A while loop was detected, but static analysis cannot reliably determine its iteration count.",
                "Review the loop's termination condition and test its behavior with large and boundary inputs.",
            )

        if collection_growth:
            growth_target = next(
                (
                    child
                    for child in ast.walk(node)
                    if (
                        isinstance(child, ast.Call)
                        and isinstance(child.func, ast.Attribute)
                        and child.func.attr in {
                            "append",
                            "extend",
                            "add",
                            "insert",
                            "update",
                            "setdefault",
                        }
                    )
                ),
                node,
            )

            add_finding(
                growth_target,
                "collection_growth",
                "info",
                "The function appears to grow or construct a collection dynamically. Auxiliary memory may increase with input size.",
                "Check whether the growing collection is necessary and whether its size can be bounded or processed incrementally.",
            )

        if not findings:
            add_finding(
                node,
                "general",
                "info",
                "No major scalability pattern was identified by the current static checks.",
                "Validate performance with representative inputs and runtime benchmarks.",
            )

        findings.sort(key=lambda item: item["line"])

        # Centralized complexity estimation.
        recursion_pattern = None

        if recursive_calls:
            recursion_pattern = (
                f"Recursive call to '{function_name}' detected."
            )

        complexity_estimate = self.complexity_estimator.estimate(
            loop_count=loop_count,
            maximum_loop_nesting=maximum_loop_nesting,
            has_linear_scan_in_loop=bool(
                membership_inside_loop or repeated_scan_calls
            ),
            has_sort=sorting,
            has_recursion=recursive,
            has_logarithmic_loop=logarithmic_while,
            has_unknown_while=unknown_while,
            grows_collection=collection_growth,
            recursion_pattern=recursion_pattern,
            has_sort_in_loop=bool(sort_inside_loop),
            has_comprehension=has_comprehension,
            has_nested_comprehension=has_nested_comprehension,
            has_quadratic_operation=bool(repeated_scan_calls),
        )

        # Preserve the original public output wording.
        legacy_space_estimate = (
            "Potentially O(n); collection size needs analysis"
            if collection_growth
            else complexity_estimate.space
        )

        return {
            "function": function_name,
            "line": node.lineno,
            "loop_count": loop_count,
            "maximum_loop_nesting": maximum_loop_nesting,
            "time_complexity_estimate": complexity_estimate.time,
            "auxiliary_space_estimate": legacy_space_estimate,
            "complexity_analysis": complexity_estimate.to_dict(),
            "patterns": patterns,
            "findings": findings,
            "confidence": complexity_estimate.confidence,
            "note": (
                "These estimates are based on static AST patterns. "
                "They are not measured runtime or memory guarantees."
            ),
        }


def main() -> int:
    if len(sys.argv) != 2:
        print(
            json.dumps({
                "status": "error",
                "error": "Usage: python analyzer.py <python_file>",
            })
        )
        return 2

    file_path = Path(sys.argv[1])

    if not file_path.exists():
        print(
            json.dumps({
                "status": "error",
                "error": f"File not found: {file_path}",
            })
        )
        return 1

    if not file_path.is_file():
        print(
            json.dumps({
                "status": "error",
                "error": f"Not a file: {file_path}",
            })
        )
        return 1

    try:
        source = file_path.read_text(encoding="utf-8")
        analyzer = CodeAnalyzer(source)
        results = analyzer.analyze()

        print(json.dumps({
            "status": "success",
            "functions": results,
        }, indent=2))

        return 0

    except SyntaxError as exc:
        print(
            json.dumps({
                "status": "error",
                "error": f"Syntax error: {exc}",
                "line": exc.lineno,
            })
        )
        return 1

    except (OSError, UnicodeError) as exc:
        print(
            json.dumps({
                "status": "error",
                "error": str(exc),
            })
        )
        return 1

    except Exception as exc:
        print(
            json.dumps({
                "status": "error",
                "error": f"Analysis failed: {exc}",
            })
        )
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
