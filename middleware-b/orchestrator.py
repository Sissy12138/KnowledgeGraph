"""Orchestrates independent agents and produces one validated handoff object."""

from __future__ import annotations

import json

from .agents import AnalysisAgent
from .models import AgentContribution, AnalysisContext, AnalysisResult, ResearchOverview, Suggestion
from .validation import validate_result


class AnalysisOrchestrator:
    def __init__(self, agents: list[AnalysisAgent]) -> None:
        if not agents:
            raise ValueError("at least one analysis agent is required")
        self._agents = agents

    def run(self, context: AnalysisContext) -> AnalysisResult:
        contributions = [agent.analyze(context) for agent in self._agents]
        result = AnalysisResult(
            paper_id=context.paper_id,
            research_overview=self._merge_overview(contributions),
            suggestions=self._deduplicate_suggestions(contributions),
            completed_agents=[contribution.agent_name for contribution in contributions],
        )
        validate_result(result, context)
        return result

    @staticmethod
    def _merge_overview(contributions: list[AgentContribution]) -> ResearchOverview:
        for contribution in contributions:
            if contribution.research_overview is not None:
                return contribution.research_overview
        return ResearchOverview([], None, None, None, None)

    @staticmethod
    def _deduplicate_suggestions(contributions: list[AgentContribution]) -> list[Suggestion]:
        seen: set[tuple[object, ...]] = set()
        unique: list[Suggestion] = []
        for contribution in contributions:
            for suggestion in contribution.suggestions:
                fingerprint = (
                    suggestion.action,
                    json.dumps(suggestion.proposed_change, ensure_ascii=False, sort_keys=True),
                    tuple(evidence.id for evidence in suggestion.evidence),
                )
                if fingerprint not in seen:
                    seen.add(fingerprint)
                    unique.append(suggestion)
        return unique
