
from dataclasses import dataclass, field


@dataclass
class ComplexityEstimate:
    time: str
    space: str
    confidence: str
    evidence: list[str] = field(default_factory=list)
    limitations: list[str] = field(default_factory=list)

    def to_dict(self):
        return {
            "time_complexity": self.time,
            "space_complexity": self.space,
            "confidence": self.confidence,
            "evidence": self.evidence,
            "limitations": self.limitations,
        }


class ComplexityEstimator:
    """Conservative, evidence-based static complexity estimator."""

    def estimate(
        self,
        loop_count: int = 0,
        maximum_loop_nesting: int = 0,
        has_linear_scan_in_loop: bool = False,
        has_sort: bool = False,
        has_recursion: bool = False,
        has_logarithmic_loop: bool = False,
        has_unknown_while: bool = False,
        grows_collection: bool = False,
        recursion_pattern: str | None = None,
        has_sort_in_loop: bool = False,
        has_comprehension: bool = False,
        has_nested_comprehension: bool = False,
        has_quadratic_operation: bool = False,
    ) -> ComplexityEstimate:

        evidence = []
        limitations = []
        confidence = "heuristic"

        if has_recursion:
            time = "Unknown"
            space = "Unknown"
            evidence.append(
                recursion_pattern or "Recursive call detected."
            )
            limitations.append(
                "Static analysis cannot determine the recurrence relation "
                "or recursion depth reliably."
            )
            limitations.append(
                "Actual time and space complexity depend on the recursive "
                "call structure and termination conditions."
            )
            return ComplexityEstimate(
                time, space, confidence, evidence, limitations
            )

        if has_unknown_while:
            time = "Unknown"
            evidence.append(
                "A while loop has no recognized logarithmic pattern."
            )
            limitations.append(
                "The loop termination condition depends on runtime values."
            )

        elif has_sort_in_loop:
            time = "O(n^2 log n) candidate"
            evidence.append(
                "Sorting occurs inside an outer iteration."
            )

        elif has_linear_scan_in_loop or has_quadratic_operation:
            time = "O(n^2) candidate"
            evidence.append(
                "A potentially linear operation occurs inside an iteration."
            )

        elif has_nested_comprehension:
            time = "O(n^2) candidate"
            evidence.append(
                "Nested comprehension iteration detected."
            )

        elif maximum_loop_nesting >= 2:
            time = "O(n^2) or higher candidate"
            evidence.append(
                "Nested iteration detected."
            )

        elif has_sort and loop_count:
            time = "O(n log n) candidate"
            evidence.append(
                "Sorting and iteration are both present."
            )

        elif has_sort:
            time = "O(n log n) candidate"
            evidence.append(
                "A sorting operation was detected."
            )

        elif has_logarithmic_loop:
            time = "O(log n) candidate"
            evidence.append(
                "A loop appears to reduce its controlling value geometrically."
            )

        elif loop_count or has_comprehension:
            time = "O(n) candidate"
            evidence.append(
                "A single iteration construct was detected."
            )

        else:
            time = "O(1) candidate"
            evidence.append(
                "No input-dependent iteration was recognized."
            )

        if grows_collection:
            space = "O(n) candidate"
            evidence.append(
                "A collection grows with the number of processed elements."
            )
        else:
            space = "O(1) candidate"

        if loop_count > 1 and maximum_loop_nesting == 1:
            evidence.append(
                "Multiple sequential loops were detected; they are not "
                "automatically multiplied."
            )

        limitations.append(
            "These are static estimates, not proofs. Runtime behavior, "
            "input relationships, library implementations, and data "
            "distributions can change actual complexity."
        )

        return ComplexityEstimate(
            time=time,
            space=space,
            confidence=confidence,
            evidence=evidence,
            limitations=limitations,
        )
