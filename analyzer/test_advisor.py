"""Suggest useful boundary and edge-case tests from Python AST structure."""

import ast


class TestAdvisor(ast.NodeVisitor):
    def __init__(self):
        self.suggestions = []
        self.seen = set()

    def add(self, category, description, reason):
        key = (category, description)

        if key in self.seen:
            return

        self.seen.add(key)
        self.suggestions.append({
            "category": category,
            "test": description,
            "reason": reason,
            "evidence_type": "static",
        })

    def visit_FunctionDef(self, node):
        self.add(
            "empty_input",
            "Call the function with an empty collection where valid.",
            f"Function {node.name} may process an input collection.",
        )
        self.add(
            "single_element",
            "Test the function with exactly one element.",
            "Single-element inputs often expose boundary-condition errors.",
        )

        for argument in node.args.args:
            if argument.arg in {"nums", "items", "values", "data", "arr"}:
                self.add(
                    "collection_boundary",
                    f"Test {argument.arg} with empty, one-element, and repeated values.",
                    "The parameter name suggests collection processing.",
                )

        for child in node.body:
            self.visit(child)

    def visit_If(self, node):
        if isinstance(node.test, ast.Compare):
            self.add(
                "comparison_boundary",
                "Test values immediately below, equal to, and above comparison boundaries.",
                "Conditional comparisons may behave differently at boundary values.",
            )
        self.generic_visit(node)

    def visit_For(self, node):
        self.add(
            "iteration_boundary",
            "Test zero iterations, one iteration, and multiple iterations.",
            "The function contains a for-loop.",
        )
        self.generic_visit(node)

    def visit_While(self, node):
        self.add(
            "termination",
            "Test inputs that cause immediate termination and multiple iterations.",
            "The function contains a while-loop.",
        )
        self.generic_visit(node)

    def visit_Subscript(self, node):
        self.add(
            "index_boundary",
            "Test the smallest and largest valid indices and invalid indices if supported.",
            "The function performs indexed access.",
        )
        self.generic_visit(node)

    def visit_Div(self, node):
        self.add(
            "division",
            "Test zero denominators and values near zero where applicable.",
            "Division may fail or become numerically unstable.",
        )
        self.generic_visit(node)


def advise_tests(source):
    tree = ast.parse(source)
    advisor = TestAdvisor()
    advisor.visit(tree)

    return {
        "status": "success",
        "suggestions": advisor.suggestions,
        "count": len(advisor.suggestions),
        "limitation": (
            "These are suggested tests inferred from syntax. Review them "
            "against the function's actual input contract."
        ),
    }