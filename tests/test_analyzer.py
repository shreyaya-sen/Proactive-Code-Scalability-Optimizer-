import textwrap

import pytest

from analyzer.analyzer import CodeAnalyzer


def analyze(source):
    """Run the analyzer on source text and return {function_name: result}."""
    results = CodeAnalyzer(textwrap.dedent(source)).analyze()
    return {item["function"]: item for item in results}


def test_single_loop_is_linear_candidate():
    result = analyze("""
        def total(nums):
            total = 0
            for x in nums:
                total += x
            return total
    """)["total"]

    assert result["loop_count"] == 1
    assert result["maximum_loop_nesting"] == 1
    assert "loop" in result["patterns"]
    assert result["time_complexity_estimate"].startswith("O(n)")


def test_nested_loops_are_quadratic_candidate():
    result = analyze("""
        def print_pairs(nums):
            for x in nums:
                for y in nums:
                    print(x, y)
    """)["print_pairs"]

    assert result["loop_count"] == 2
    assert result["maximum_loop_nesting"] == 2
    assert "nested loops" in result["patterns"]
    assert "O(n^2)" in result["time_complexity_estimate"]


def test_sequential_loops_are_not_nested():
    result = analyze("""
        def process(nums):
            for x in nums:
                print(x)
            for y in nums:
                print(y)
    """)["process"]

    assert result["loop_count"] == 2
    assert result["maximum_loop_nesting"] == 1
    assert "multiple sequential loops" in result["patterns"]
    assert "nested loops" not in result["patterns"]


def test_function_without_loops_is_constant_candidate():
    result = analyze("""
        def add(a, b):
            return a + b
    """)["add"]

    assert result["loop_count"] == 0
    assert result["time_complexity_estimate"].startswith("O(1)")
    assert result["auxiliary_space_estimate"].startswith("O(1)")


def test_recursion_is_reported_as_unknown():
    result = analyze("""
        def fact(n):
            if n <= 1:
                return 1
            return n * fact(n - 1)
    """)["fact"]

    assert "recursion" in result["patterns"]
    assert result["time_complexity_estimate"].startswith("Unknown")


def test_halving_while_loop_is_logarithmic_candidate():
    result = analyze("""
        def halvings(n):
            count = 0
            while n > 1:
                n //= 2
                count += 1
            return count
    """)["halvings"]

    assert "potential logarithmic loop" in result["patterns"]
    assert "O(log n)" in result["time_complexity_estimate"]


def test_sorted_call_is_detected():
    result = analyze("""
        def ordered(nums):
            return sorted(nums)
    """)["ordered"]

    assert "sorting" in result["patterns"]
    assert "O(n log n)" in result["time_complexity_estimate"]


def test_collection_growth_marks_space_as_possibly_linear():
    result = analyze("""
        def copy_items(nums):
            result = []
            for x in nums:
                result.append(x)
            return result
    """)["copy_items"]

    assert result["auxiliary_space_estimate"].startswith("Potentially O(n)")


def test_every_function_in_a_file_is_reported():
    results = analyze("""
        def first():
            return 1

        def second():
            return 2
    """)

    assert set(results) == {"first", "second"}


def test_invalid_syntax_raises_syntax_error():
    with pytest.raises(SyntaxError):
        CodeAnalyzer("def broken(:")


def test_membership_check_in_loop_should_be_quadratic():
    result = analyze("""
        def unique(nums):
            seen = []
            for x in nums:
                if x not in seen:
                    seen.append(x)
            return seen
    """)["unique"]

    assert "linear scan inside loop" in result["patterns"]
    assert "O(n^2)" in result["time_complexity_estimate"]


def test_set_membership_in_loop_is_not_flagged():
    result = analyze("""
        def unique(nums):
            seen = set()
            output = []
            for x in nums:
                if x not in seen:
                    seen.add(x)
                    output.append(x)
            return output
    """)["unique"]

    assert "linear scan inside loop" not in result["patterns"]
    assert result["time_complexity_estimate"].startswith("O(n)")


def test_membership_against_literal_is_not_flagged():
    result = analyze("""
        def only_small(nums):
            for x in nums:
                if x in (1, 2, 3):
                    print(x)
    """)["only_small"]

    assert "linear scan inside loop" not in result["patterns"]


def test_index_call_in_loop_is_quadratic_candidate():
    result = analyze("""
        def positions(data, nums):
            for x in nums:
                print(data.index(x))
    """)["positions"]

    assert "linear scan inside loop" in result["patterns"]
    assert "O(n^2)" in result["time_complexity_estimate"]


def test_membership_outside_loop_is_not_quadratic():
    result = analyze("""
        def has_value(nums, x):
            return x in nums
    """)["has_value"]

    assert "membership test" in result["patterns"]
    assert "linear scan inside loop" not in result["patterns"]