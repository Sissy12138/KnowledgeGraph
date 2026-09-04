"""Offline fixture agents for end-to-end preflight checks."""

from __future__ import annotations

from .agents import AnalysisAgent, OverviewAgent
from .document import DocumentChunk
from .models import AgentContribution, AnalysisContext, Suggestion, SuggestionAction


class FixtureSuggestionAgent:
    def __init__(self, name: str, action: SuggestionAction, proposed_change: dict[str, object], chunk: DocumentChunk, excerpt: str) -> None:
        self.name = name
        self._action = action
        self._proposed_change = proposed_change
        self._chunk = chunk
        self._excerpt = excerpt

    def analyze(self, context: AnalysisContext) -> AgentContribution:
        evidence = self._chunk.evidence_for(self._excerpt)
        suggestion = Suggestion(
            id=f"suggestion_{self.name}_{self._chunk.id[-8:]}",
            paper_id=context.paper_id,
            action=self._action,
            proposed_change=self._proposed_change,
            reason="Offline fixture used to verify the pipeline; replace with a model-backed agent later.",
            confidence=0.8,
            evidence=[evidence],
        )
        return AgentContribution(agent_name=self.name, suggestions=[suggestion])


def preflight_agents(chunk: DocumentChunk) -> list[AnalysisAgent]:
    excerpt = "Participants completed a Bayesian bandit task under uncertainty."
    return [
        OverviewAgent(),
        FixtureSuggestionAgent("concept", "addConcept", {"name": "Uncertainty"}, chunk, excerpt),
        FixtureSuggestionAgent("method", "addMethod", {"name": "Bayesian bandit task", "methodType": "experiment"}, chunk, excerpt),
        FixtureSuggestionAgent("finding", "addFinding", {"statement": "Participants completed a Bayesian bandit task under uncertainty."}, chunk, excerpt),
        FixtureSuggestionAgent("relation", "addRelation", {"sourceId": "paper_preflight", "targetId": "concept_uncertainty", "relationType": "studies"}, chunk, excerpt),
    ]
