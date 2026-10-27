import ast
import json
import sys


class CodeAnalyzer:
    def __init__(self, source):
        self.tree = ast.parse(source)

    def analyze(self):
        results = []

        for node in ast.walk(self.tree):
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                results.append(self.analyze_function(node))

        return results

    def analyze_function(self, node):
        patterns = []
        loop_count = 0
        max_loop_depth = 0
        has_nested_loops = False
        has_log_loop = False
        has_unknown_while = False
        has_sort = False
        has_recursion = False
        has_search = False
        has_growing_collection = False

        def add_pattern(pattern):
            if pattern not in patterns:
                patterns.append(pattern)

        def is_logarithmic_while(statement):
            # Recognize common updates such as i //= 2 or i *= 2.
            # Also require the updated variable to occur in the condition.
            if not isinstance(statement, ast.While):
                return False

            condition_names = {
                item.id for item in ast.walk(statement.test)
                if isinstance(item, ast.Name)
            }

            for item in ast.walk(statement):
                target_name = None
                factor = None

                if isinstance(item, ast.AugAssign):
                    if isinstance(item.target, ast.Name):
                        target_name = item.target.id

                    if isinstance(item.value, ast.Constant):
                        factor = item.value.value

                    if (
                        target_name in condition_names
                        and isinstance(item.op, (ast.Mult, ast.FloorDiv))
                        and isinstance(factor, int)
                        and factor > 1
                    ):
                        return True

                if isinstance(item, ast.Assign):
                    if isinstance(item.value, ast.BinOp):
                        if isinstance(item.value.left, ast.Name):
                            target_name = item.value.left.id

                        if isinstance(item.value.right, ast.Constant):
                            factor = item.value.right.value

                        if (
                            target_name in condition_names
                            and isinstance(
                                item.value.op,
                                (ast.Mult, ast.FloorDiv)
                            )
                            and isinstance(factor, int)
                            and factor > 1
                        ):
                            if any(
                                isinstance(target, ast.Name)
                                and target.id == target_name
                                for target in item.targets
                            ):
                                return True

            return False

        def inspect_calls(statement):
            nonlocal has_sort, has_recursion
            nonlocal has_search, has_growing_collection

            for item in ast.walk(statement):
                if not isinstance(item, ast.Call):
                    continue

                func = item.func

                if isinstance(func, ast.Name):
                    if func.id == "sorted":
                        has_sort = True
                        add_pattern("sorting")

                    if func.id == node.name:
                        has_recursion = True
                        add_pattern("recursion")

                    if func.id in ("list", "dict", "set"):
                        has_growing_collection = True
                        add_pattern("collection construction")

                elif isinstance(func, ast.Attribute):
                    if func.attr == "sort":
                        has_sort = True
                        add_pattern("sorting")

                    if func.attr in ("index", "count"):
                        has_search = True
                        add_pattern("potential repeated search")

                    if func.attr in ("append", "extend", "add", "update"):
                        has_growing_collection = True
                        add_pattern("collection modification")

        def visit_block(statements, depth=0):
            nonlocal loop_count, max_loop_depth
            nonlocal has_nested_loops, has_log_loop
            nonlocal has_unknown_while, has_growing_collection

            for statement in statements:
                if isinstance(statement, (ast.For, ast.AsyncFor)):
                    loop_count += 1
                    max_loop_depth = max(max_loop_depth, depth + 1)

                    if depth > 0:
                        has_nested_loops = True
                        add_pattern("nested loops")
                    else:
                        add_pattern("loop")

                    visit_block(statement.body, depth + 1)
                    visit_block(statement.orelse, depth)
                    continue

                if isinstance(statement, ast.While):
                    loop_count += 1
                    max_loop_depth = max(max_loop_depth, depth + 1)
                    add_pattern("while loop")

                    if depth > 0:
                        has_nested_loops = True
                        add_pattern("nested loops")

                    if is_logarithmic_while(statement):
                        has_log_loop = True
                        add_pattern("potential logarithmic loop")
                    else:
                        has_unknown_while = True

                    inspect_calls(statement.test)
                    visit_block(statement.body, depth + 1)
                    visit_block(statement.orelse, depth)
                    continue

                # Identify collections created by literals or comprehensions.
                if isinstance(statement, (ast.Assign, ast.AnnAssign)):
                    value = statement.value

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
                        has_growing_collection = True
                        add_pattern("collection creation")

                inspect_calls(statement)

                # Conditions and nested blocks can contain loops too.
                if isinstance(statement, ast.If):
                    visit_block(statement.body, depth)
                    visit_block(statement.orelse, depth)

                elif isinstance(statement, (ast.Try,)):
                    visit_block(statement.body, depth)
                    visit_block(statement.orelse, depth)
                    visit_block(statement.finalbody, depth)

                    for handler in statement.handlers:
                        visit_block(handler.body, depth)

                elif isinstance(statement, (ast.With, ast.AsyncWith)):
                    visit_block(statement.body, depth)

        visit_block(node.body)

        if loop_count > 1 and not has_nested_loops:
            add_pattern("multiple sequential loops")

        # TIME COMPLEXITY: structural estimates, not proof.
        if has_recursion:
            time_complexity = (
                "Unknown: recursive call complexity needs analysis"
            )
        elif has_unknown_while:
            time_complexity = (
                "Unknown: while-loop termination or growth needs analysis"
            )
        elif has_nested_loops:
            time_complexity = (
                "O(n^2) or higher candidate; inspect loop bounds"
            )
        elif has_log_loop:
            time_complexity = (
                "O(log n) candidate for the recognized loop"
            )
        elif has_sort and loop_count:
            time_complexity = (
                "O(n log n) or higher; sorting and other operations"
            )
        elif has_sort:
            time_complexity = "O(n log n) candidate for sorting"
        elif loop_count or has_search:
            time_complexity = (
                "O(n) or higher candidate; inspect operation costs"
            )
        else:
            time_complexity = (
                "O(1) candidate; hidden growing work may exist"
            )

        # AUXILIARY SPACE: memory beyond the supplied input.
        if has_recursion:
            space_complexity = (
                "Unknown: recursion stack may grow with input"
            )
        elif has_growing_collection:
            space_complexity = (
                "Potentially O(n); collection size needs analysis"
            )
        else:
            space_complexity = (
                "O(1) candidate, excluding input and returned output"
            )

        return {
            "function": node.name,
            "line": node.lineno,
            "loop_count": loop_count,
            "maximum_loop_nesting": max_loop_depth,
            "time_complexity_estimate": time_complexity,
            "auxiliary_space_estimate": space_complexity,
            "patterns": patterns,
            "confidence": "heuristic",
            "note": (
                "Static estimate. Exact complexity requires reasoning "
                "about loop bounds, data sizes, called functions, "
                "recursion and collection growth."
            ),
        }


def main():
    if len(sys.argv) != 2:
        print(json.dumps({
            "status": "error",
            "error": "Usage: python analyzer.py path/to/file.py"
        }, indent=2))
        sys.exit(1)

    try:
        with open(sys.argv[1], "r", encoding="utf-8") as file:
            source = file.read()

        result = {
            "status": "success",
            "functions": CodeAnalyzer(source).analyze()
        }

    except SyntaxError as error:
        result = {
            "status": "error",
            "error": "Invalid Python syntax",
            "line": error.lineno
        }

    except OSError as error:
        result = {
            "status": "error",
            "error": str(error)
        }

    print(json.dumps(result, indent=2))


if __name__ == "__main__":
    main()