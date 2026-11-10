"""Find observed performance crossovers from benchmark measurements."""


def find_crossover(first_results, second_results):
    """Compare two benchmark series keyed by input_size.

    Each item must contain input_size and median_seconds.
    The result is an observed crossover, not a theoretical threshold.
    """

    def normalize(items):
        normalized = {}

        for item in items:
            size = item.get("input_size")
            duration = item.get("median_seconds")

            if (
                not isinstance(size, int)
                or not isinstance(duration, (int, float))
                or duration < 0
            ):
                continue

            normalized[size] = float(duration)

        return normalized

    first = normalize(first_results)
    second = normalize(second_results)
    shared_sizes = sorted(set(first) & set(second))

    if len(shared_sizes) < 2:
        return {
            "status": "insufficient_data",
            "message": "At least two shared input sizes are required.",
            "observations": [],
        }

    observations = []
    previous_winner = None
    crossover = None

    for size in shared_sizes:
        first_time = first[size]
        second_time = second[size]

        if first_time == second_time:
            winner = "tie"
        elif first_time < second_time:
            winner = "first"
        else:
            winner = "second"

        observations.append({
            "input_size": size,
            "first_seconds": first_time,
            "second_seconds": second_time,
            "faster": winner,
        })

        if (
            previous_winner
            and winner != "tie"
            and previous_winner != "tie"
            and winner != previous_winner
            and crossover is None
        ):
            crossover = {
                "between_input_sizes": [
                    observations[-2]["input_size"],
                    size,
                ],
                "winner_before": previous_winner,
                "winner_after": winner,
            }

        if winner != "tie":
            previous_winner = winner

    return {
        "status": "success",
        "observed_crossover": crossover,
        "observations": observations,
        "evidence_type": "empirical",
        "limitation": (
            "The observed crossover depends on hardware, interpreter, "
            "input distribution, and measurement noise. It is not a "
            "universal break-even point."
        ),
    }