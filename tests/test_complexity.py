
import pytest

from analyzer.complexity import ComplexityEstimator


@pytest.fixture
def estimator():
    return ComplexityEstimator()


def test_constant_time_candidate(estimator):
    result = estimator.estimate()

    assert result.time == "O(1) candidate"
    assert result.confidence == "heuristic"


def test_linear_time_candidate(estimator):
    result = estimator.estimate(loop_count=1)

    assert result.time == "O(n) candidate"


def test_nested_loop_candidate(estimator):
    result = estimator.estimate(
        loop_count=2,
        maximum_loop_nesting=2,
    )

    assert result.time == "O(n^2) or higher candidate"


def test_linear_scan_inside_loop(estimator):
    result = estimator.estimate(
        loop_count=1,
        has_linear_scan_in_loop=True,
    )

    assert result.time == "O(n^2) candidate"


def test_sorting_complexity(estimator):
    result = estimator.estimate(has_sort=True)

    assert result.time == "O(n log n) candidate"


def test_recursion_complexity_is_unknown(estimator):
    result = estimator.estimate(has_recursion=True)

    assert result.time == "Unknown"
    assert result.space == "Unknown"


def test_unknown_while_complexity(estimator):
    result = estimator.estimate(has_unknown_while=True)

    assert result.time == "Unknown"


def test_growing_collection_space(estimator):
    result = estimator.estimate(grows_collection=True)

    assert result.space == "O(n) candidate"


def test_evidence_and_limitations_are_returned(estimator):
    result = estimator.estimate(
        loop_count=2,
        maximum_loop_nesting=2,
    )

    output = result.to_dict()

    assert output["evidence"]
    assert output["limitations"]
    assert output["confidence"] == "heuristic"
