"""Faster version of demo_phase2.unique, used to test Verify and Crossover."""


def unique(items):
    """Return items with duplicates removed, keeping first-seen order."""
    seen = set()
    result = []

    for x in items:
        if x not in seen:
            seen.add(x)
            result.append(x)

    return result