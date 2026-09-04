"""One-command offline verification of B's pre-API capabilities."""

from __future__ import annotations

from .budget import enforce_budget, estimate_cost_usd
from .document import chunk_sections, split_sections
from .fixtures import preflight_agents
from .jobs import AnalysisJobState
from .models import AnalysisContext
from .orchestrator import AnalysisOrchestrator
from .providers import default_provider_config


SAMPLE_TEXT = """# Abstract
Participants completed a Bayesian bandit task under uncertainty.

# Methods
Participants completed a Bayesian bandit task under uncertainty."""


def run_preflight() -> dict[str, object]:
    config = default_provider_config("qwen")
    config.validate()
    sections = split_sections(SAMPLE_TEXT)
    chunks = chunk_sections("paper_preflight", sections)
    job = AnalysisJobState("job_preflight", "paper_preflight")
    job.transition("processing", "preprocessing", 10, "Text split into sections and chunks.")
    context = AnalysisContext(
        paper_id="paper_preflight",
        title="Offline preflight paper",
        sections={section.name: section.text for section in sections},
        existing_node_ids=frozenset({"concept_uncertainty"}),
    )
    job.update("analyzing", 50, "Fixture agents generated contract-shaped outputs.")
    result = AnalysisOrchestrator(preflight_agents(chunks[0])).run(context)
    job.update("aggregating", 75, "Suggestions were deduplicated.")
    job.update("validating", 90, "B-to-A contract validation passed.")
    job.transition("completed", "completed", 100, "Offline preflight completed.")
    estimated_cost = estimate_cost_usd("qwen", 50_000, 6_000)
    enforce_budget(estimated_cost, 0.01)
    return {
        "providerSettings": config.public_settings(),
        "chunkCount": len(chunks),
        "result": result.to_api(),
        "job": {"status": job.status, "stage": job.stage, "progress": job.progress, "eventCount": len(job.events)},
        "estimatedCostUsd": round(estimated_cost, 6),
    }
