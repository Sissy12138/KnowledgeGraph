"""A small executable example for B's handoff payload."""

from __future__ import annotations

import argparse
import json

from .agents import EmptySuggestionAgent, OverviewAgent
from .models import AnalysisContext
from .orchestrator import AnalysisOrchestrator
from .preflight import run_preflight


def main() -> None:
    parser = argparse.ArgumentParser(description="Run B-side offline checks without a model API.")
    parser.add_argument("command", choices=["demo", "preflight"], nargs="?", default="preflight")
    args = parser.parse_args()
    if args.command == "preflight":
        print(json.dumps(run_preflight(), ensure_ascii=False, indent=2))
        return
    context = AnalysisContext(
        paper_id="paper_001",
        title="Social Contexts and Exploration Under Uncertainty",
        sections={"Abstract": "This study examines exploration under uncertainty in social contexts."},
    )
    result = AnalysisOrchestrator([OverviewAgent(), EmptySuggestionAgent()]).run(context)
    print(json.dumps(result.to_api(), ensure_ascii=False, indent=2))


if __name__ == "__main__":
    main()
