"""Contract-shaped domain models for B's handoff to A."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Literal

SuggestionAction = Literal["addConcept", "addMethod", "addFinding", "addRelation"]
SuggestionStatus = Literal["pending", "accepted", "rejected"]


@dataclass(frozen=True)
class Evidence:
    id: str
    paper_id: str
    section: str | None
    text: str

    def to_api(self) -> dict[str, object]:
        return {"id": self.id, "paperId": self.paper_id, "section": self.section, "text": self.text}


@dataclass(frozen=True)
class ResearchOverview:
    research_topics: list[str]
    research_question: str | None
    sample: str | None
    methods: str | None
    main_results: str | None

    def to_api(self) -> dict[str, object]:
        return {
            "researchTopics": self.research_topics,
            "researchQuestion": self.research_question,
            "sample": self.sample,
            "methods": self.methods,
            "mainResults": self.main_results,
        }


@dataclass(frozen=True)
class Suggestion:
    id: str
    paper_id: str
    action: SuggestionAction
    proposed_change: dict[str, object]
    reason: str
    confidence: float | None
    evidence: list[Evidence]
    status: SuggestionStatus = "pending"
    reviewed_at: str | None = None
    review_comment: str | None = None

    def to_api(self) -> dict[str, object]:
        return {
            "id": self.id,
            "paperId": self.paper_id,
            "status": self.status,
            "action": self.action,
            "proposedChange": self.proposed_change,
            "reason": self.reason,
            "confidence": self.confidence,
            "evidence": [item.to_api() for item in self.evidence],
            "reviewedAt": self.reviewed_at,
            "reviewComment": self.review_comment,
        }


@dataclass(frozen=True)
class AnalysisContext:
    paper_id: str
    title: str
    sections: dict[str, str]
    existing_node_ids: frozenset[str] = frozenset()

    def text(self) -> str:
        return "\n\n".join(f"{section}\n{content}" for section, content in self.sections.items())


@dataclass(frozen=True)
class AgentContribution:
    agent_name: str
    research_overview: ResearchOverview | None = None
    suggestions: list[Suggestion] = field(default_factory=list)


@dataclass(frozen=True)
class AnalysisResult:
    paper_id: str
    research_overview: ResearchOverview
    suggestions: list[Suggestion]
    completed_agents: list[str]

    def to_api(self) -> dict[str, object]:
        return {
            "paperId": self.paper_id,
            "researchOverview": self.research_overview.to_api(),
            "suggestions": [item.to_api() for item in self.suggestions],
            "completedAgents": self.completed_agents,
        }
