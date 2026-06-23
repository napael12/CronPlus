#!/usr/bin/env python3
"""Wait N seconds, repeated for N cycles.

Usage:
    python wait_cycle.py --wait 5 --cycle 3
    python wait_cycle.py --wait 5 --cycle 3 --exception
    python wait_cycle.py --wait 5 --cycle 3 --param env=staging --param retries=2
"""

import argparse
import time


def parse_params(items: list[str]) -> dict[str, str]:
    params = {}
    for item in items:
        if "=" not in item:
            raise argparse.ArgumentTypeError(
                f"--param must be in KEY=VALUE format, got: {item}"
            )
        key, value = item.split("=", 1)
        params[key] = value
    return params


def run(cycle: int, wait: float, exception: bool, params: dict[str, str]) -> None:
    print("Parameters:")
    for key, value in params.items():
        print(f"  {key} = {value}")

    for i in range(1, cycle + 1):
        print(f"Cycle {i}/{cycle}: waiting {wait}s...")
        time.sleep(wait)
    print("Done.")

    if exception:
        raise RuntimeError("Run completed; raising exception as requested (--exception).")


def main():
    parser = argparse.ArgumentParser(description="Wait, repeated over multiple cycles.")
    parser.add_argument("--wait", type=float, required=True, help="Seconds to wait per cycle")
    parser.add_argument("--cycle", type=int, required=True, help="Number of times to repeat the wait")
    parser.add_argument("--exception", action="store_true", help="Raise an exception after the run finishes")
    parser.add_argument(
        "--param",
        action="append",
        default=[],
        metavar="KEY=VALUE",
        help="Additional key=value parameter (repeatable)",
    )
    args = parser.parse_args()

    try:
        params = parse_params(args.param)
    except argparse.ArgumentTypeError as e:
        parser.error(str(e))

    run(args.cycle, args.wait, args.exception, params)


if __name__ == "__main__":
    main()