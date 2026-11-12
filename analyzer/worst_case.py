"""Generate bounded, deterministic stress inputs for common code patterns."""



MAX_SIZE = 100_000


def generate_worst_case(pattern, size):
    if not isinstance(size, int) or not 0 <= size <= MAX_SIZE:
        raise ValueError(f"size must be between 0 and {MAX_SIZE}")

    if pattern == "duplicate_search":
        # Forces repeated unsuccessful membership checks for many inputs.
        return list(range(size))

    if pattern == "duplicate_heavy":
        # Tests repeated values and duplicate-handling behavior.
        return [0] * size

    if pattern == "reverse_sorted":
        return list(range(size, 0, -1))

    if pattern == "already_sorted":
        return list(range(size))

    if pattern == "all_equal":
        return [1] * size

    if pattern == "alternating":
        return [index % 2 for index in range(size)]

    if pattern == "unique_strings":
        return [f"item-{index}" for index in range(size)]

    raise ValueError(f"Unknown pattern: {pattern}")


def recommend_patterns(source):
    lowered = source.lower()
    recommendations = []

    if " in " in lowered or ".index(" in lowered or ".count(" in lowered:
        recommendations.append({
            "pattern": "duplicate_search",
            "reason": "The code appears to perform membership or search operations.",
        })

    if "sort(" in lowered or "sorted(" in lowered:
        recommendations.extend([
            {
                "pattern": "reverse_sorted",
                "reason": "Checks sorting behavior on reverse-ordered input.",
            },
            {
                "pattern": "already_sorted",
                "reason": "Checks sorting behavior on already ordered input.",
            },
        ])

    if "set(" in lowered or "unique" in lowered or "duplicate" in lowered:
        recommendations.append({
            "pattern": "duplicate_heavy",
            "reason": "Checks duplicate-heavy input behavior.",
        })

    if not recommendations:
        recommendations.append({
            "pattern": "unique_strings",
            "reason": "Provides a deterministic larger input for general testing.",
        })

    return recommendations


def generate_suite(pattern, sizes=(10, 100, 1000)):
    return [
        {
            "pattern": pattern,
            "size": size,
            "input": generate_worst_case(pattern, size),
            "evidence_type": "synthetic",
        }
        for size in sizes
    ]