"""Demo file for Phase 2 — benchmark, DSA, test suggestion, crossover."""


def unique(items):
    """Return items with duplicates removed (slow O(n^2) version)."""
    seen = []
    result = []
    for x in items:
        if x not in seen:        # linear scan inside loop -> O(n^2)
            seen.append(x)
            result.append(x)
    return result


def common(items, lookup):
    """Return items that appear in lookup (slow: lookup is a list)."""
    result = []
    for item in items:
        if item in lookup:       # linear scan inside loop -> O(n^2)
            result.append(item)
    return result


def kth_values(nums, queries):
    """Return the index of each query value in nums."""
    return [nums.index(q) for q in queries]   # O(n) per query -> O(n^2)


def positions(nums, queries):
    """Sum of sorted-nums[0] + each query (sort repeated each loop)."""
    total = 0
    for q in queries:
        total += sorted(nums)[0] + q           # sorted() inside loop -> O(n^2 log n)
    return total