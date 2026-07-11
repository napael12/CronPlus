#!/usr/bin/env python3
"""
Example: workflow-level step variables.

This script shows how to export values from one step so that subsequent
steps in the same workflow run can reference them via {step.NAME}.

--- How to use ---

Step 1  (this script):
  Command:    python
  Parameters: scripts/step_vars_example.py --mode produce
  Use shell:  off

Step 2  (any script or command):
  Command:    python
  Parameters: scripts/step_vars_example.py --mode consume --greeting {step.GREETING} --ts {step.RUN_TIMESTAMP}
  Use shell:  off

When Step 1 runs, CronPlus intercepts any stdout line that matches
  ::set-var NAME=VALUE
strips it from stored output, and makes it available to all later steps
in the same workflow run as {step.NAME}.
"""

import argparse
import datetime
import os
import sys


def produce():
    """Emit variables for downstream steps."""
    greeting = "hello from step 1"
    timestamp = datetime.datetime.now().strftime("%Y-%m-%dT%H:%M:%S")
    artifact = os.path.join(os.getcwd(), "output.txt")

    print("Step 1 is running — computing values...")
    print(f"  greeting  = {greeting}")
    print(f"  timestamp = {timestamp}")
    print(f"  artifact  = {artifact}")

    # Export values for subsequent steps.
    # CronPlus removes these lines from stored stdout; they won't appear in logs.
    print(f"::set-var GREETING={greeting}")
    print(f"::set-var RUN_TIMESTAMP={timestamp}")
    print(f"::set-var ARTIFACT_PATH={artifact}")

    print("Step 1 complete.")


def consume(greeting: str, ts: str):
    """Receive variables injected by CronPlus variable resolution."""
    print("Step 2 received values from Step 1:")
    print(f"  GREETING      = {greeting!r}")
    print(f"  RUN_TIMESTAMP = {ts!r}")

    if not greeting or greeting.startswith("{step."):
        print("ERROR: variable was not resolved — check workflow configuration", file=sys.stderr)
        sys.exit(1)

    print("Step 2 complete.")


def main():
    parser = argparse.ArgumentParser(description="Step-vars demo")
    parser.add_argument("--mode", choices=["produce", "consume"], required=True)
    parser.add_argument("--greeting", default="", help="Injected by CronPlus from {step.GREETING}")
    parser.add_argument("--ts", default="", help="Injected by CronPlus from {step.RUN_TIMESTAMP}")
    args = parser.parse_args()

    if args.mode == "produce":
        produce()
    else:
        consume(args.greeting, args.ts)


if __name__ == "__main__":
    main()
