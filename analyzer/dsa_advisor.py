"""Recommend data structures based on recognizable Python AST patterns."""

import ast


class DSAVisitor(ast.NodeVisitor):
    def __init__(self):
        self.recommendations = []
        self.seen = set()
        self.loop_depth = 0
        self.current_function = "<module>"

    def add(self, node, category, current_pattern, recommendation, reason):
        line = getattr(node, "lineno", None)
        key = (self.current_function, category, current_pattern)

        if key in self.seen:
            return

        self.seen.add(key)
        self.recommendations.append({
            "function": self.current_function,
            "line": line,
            "category": category,
            "current_pattern": current_pattern,
            "recommendation": recommendation,
            "reason": reason,
            "evidence_type": "static",
        })

    def visit_FunctionDef(self, node):
        previous_function = self.current_function
        previous_depth = self.loop_depth

        self.current_function = node.name
        self.loop_depth = 0
        self.generic_visit(node)

        self.current_function = previous_function
        self.loop_depth = previous_depth

    def visit_AsyncFunctionDef(self, node):
        self.visit_FunctionDef(node)

    def visit_For(self, node):
        self.loop_depth += 1
        self.visit(node.iter)

        for statement in node.body:
            self.visit(statement)

        for statement in node.orelse:
            self.visit(statement)

        self.loop_depth -= 1

    def visit_While(self, node):
        self.loop_depth += 1
        self.generic_visit(node)
        self.loop_depth -= 1

    def visit_Compare(self, node):
        if self.loop_depth:
            for operator, comparator in zip(node.ops, node.comparators):
                if isinstance(operator, (ast.In, ast.NotIn)) and isinstance(
                    comparator, (ast.List, ast.Tuple)
                ):
                    self.add(
                        node,
                        "membership_lookup",
                        "Repeated membership checks against a list or tuple",
                        "Consider a set for repeated membership checks",
                        "Average set membership is typically O(1), while "
                        "list membership is O(n). Set conversion also "
                        "requires time and memory.",
                    )

        self.generic_visit(node)

    def visit_Call(self, node):
        if isinstance(node.func, ast.Attribute):
            method = node.func.attr

            if method in {"index", "count"} and self.loop_depth:
                self.add(
                    node,
                    "repeated_search",
                    f".{method}() inside a loop",
                    "Consider a dictionary or precomputed index",
                    "Repeated linear searches can increase total runtime.",
                )

            if method == "pop" and node.args:
                first = node.args[0]

                if isinstance(first, ast.Constant) and first.value == 0:
                    self.add(
                        node,
                        "queue_operations",
                        "list.pop(0)",
                        "Consider collections.deque and popleft()",
                        "Removing the first element of a list shifts "
                        "remaining elements.",
                    )

            if method == "sort" and self.loop_depth:
                self.add(
                    node,
                    "repeated_sort",
                    "list.sort() inside a loop",
                    "Consider collecting values and sorting once",
                    "Repeated sorting can cost substantially more than "
                    "one sort after collection.",
                )

        if isinstance(node.func, ast.Name) and node.func.id == "sorted":
            if self.loop_depth:
                self.add(
                    node,
                    "repeated_sort",
                    "sorted() inside a loop",
                    "Consider collecting values and sorting once",
                    "Repeated sorting can increase runtime to approximately "
                    "O(k * n log n) for k loop iterations.",
                )

        self.generic_visit(node)


def recommend_dsa(source):
    tree = ast.parse(source)
    visitor = DSAVisitor()
    visitor.visit(tree)

    return {
        "status": "success",
        "recommendations": visitor.recommendations,
        "count": len(visitor.recommendations),
        "limitation": (
            "Recommendations are heuristic. A different data structure "
            "may change ordering, duplicate handling, or other semantics."
        ),
    }