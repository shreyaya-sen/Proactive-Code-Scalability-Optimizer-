def unique(nums):
    seen = []
    for x in nums:
        if x not in seen:
            seen.append(x)
    return seen


def print_pairs(nums):
    for x in nums:
        for y in nums:
            print(x, y)


def sort_each(groups):
    for group in groups:
        print(sorted(group))