"""Agent interfaces and small deterministic agents for the initial pipeline."""

from __future__ import annotations

from typing import Protocol

from .models import AgentContribution, AnalysisContext, ResearchOverview


class AnalysisAgent(Protocol):
    name: str

    def analyze(self, context: AnalysisContext) -> AgentContribution:
        """Return only claims backed by the supplied context."""


class OverviewAgent:
    """Produces a conservative overview without inferring unsupported fields."""

    name = "overview"

    def analyze(self, context: AnalysisContext) -> AgentContribution:
        abstract = context.sections.get("Abstract", "").strip()
        return AgentContribution(
            agent_name=self.name,
            research_overview=ResearchOverview(
                research_topics=[],
                research_question=abstract or None,
                sample=None,
                methods=None,
                main_results=None,
            ),
        )


class EmptySuggestionAgent:
    """Safe default until a model-backed extraction agent is configured."""

    name = "suggestion"

    def analyze(self, context: AnalysisContext) -> AgentContribution:
        return AgentContribution(agent_name=self.name)
