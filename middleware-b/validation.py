"""Validation of B output before A receives it."""

from __future__ import annotations

from .models import AnalysisContext, AnalysisResult, Evidence, Suggestion

ALLOWED_RELATION_TYPES = {
    "studies",
    "uses",
    "reports",
    "supports",
    "contradicts",
    "relatedTo",
    "broaderThan",
    "cites",
}


class ContractValidationError(ValueError):
    pass


def validate_result(result: AnalysisResult, context: AnalysisContext) -> None:
    if result.paper_id != context.paper_id:
        raise ContractValidationError("result paperId must match the analysis context")
    for suggestion in result.suggestions:
        _validate_suggestion(suggestion, context)


def _validate_suggestion(suggestion: Suggestion, context: AnalysisContext) -> None:
    if suggestion.paper_id != context.paper_id:
        raise ContractValidationError("suggestion paperId must match the analysis context")
    if suggestion.status != "pending":
        raise ContractValidationError("B may only submit pending suggestions")
    if suggestion.confidence is not None and not 0 <= suggestion.confidence <= 1:
        raise ContractValidationError("confidence must be null or between 0 and 1")
    for evidence in suggestion.evidence:
        _validate_evidence(evidence, context.paper_id)
    _validate_change(suggestion, context)


def _validate_evidence(evidence: Evidence, paper_id: str) -> None:
    if evidence.paper_id != paper_id:
        raise ContractValidationError("evidence paperId must match its suggestion")
    if not evidence.id or not evidence.text.strip():
        raise ContractValidationError("evidence requires a non-empty id and text")


def _validate_change(suggestion: Suggestion, context: AnalysisContext) -> None:
    change = suggestion.proposed_change
    if not isinstance(change, dict):
        raise ContractValidationError("proposedChange must be an object")
    required_by_action = {
        "addConcept": {"name"},
        "addMethod": {"name", "methodType"},
        "addFinding": {"statement"},
        "addRelation": {"sourceId", "targetId", "relationType"},
    }
    missing = required_by_action[suggestion.action] - change.keys()
    if missing:
        raise ContractValidationError(f"{suggestion.action} is missing: {', '.join(sorted(missing))}")
    if suggestion.action != "addRelation":
        return
    relation_type = change["relationType"]
    if relation_type not in ALLOWED_RELATION_TYPES:
        raise ContractValidationError("addRelation uses an unsupported relationType")
    node_ids = context.existing_node_ids | {context.paper_id}
    if change["sourceId"] not in node_ids or change["targetId"] not in node_ids:
        raise ContractValidationError("addRelation may only reference existing nodes")
