"""Bridge evidence-validated extraction into the v0.5 submission contract."""

from __future__ import annotations

from hashlib import sha256

from .entity_normalization import EntityNormalizer, NormalizedEntity, RawEntity
from .models import Evidence
from .paper_extraction import ExtractedItem, StructuredPaperExtraction
from .research_overview import ResearchOverviewResult


class V03ResultBuilder:
    """Builds only pending v0.5 entity review groups; matched results stay in B."""

    def __init__(self, normalizer: EntityNormalizer) -> None:
        self._normalizer = normalizer

    def build(self, extraction: StructuredPaperExtraction, research_overview: ResearchOverviewResult | dict[str, object]) -> dict[str, object]:
        evidence, evidence_refs = self._evidence_payload(extraction)
        concepts = self._entity_payloads("concept", extraction.paper_id, extraction.concepts, evidence_refs)
        methods = self._entity_payloads("method", extraction.paper_id, extraction.methods, evidence_refs)
        findings = [self._finding_payload(extraction.paper_id, index, item, evidence_refs) for index, item in enumerate(extraction.findings)]
        overview_payload = research_overview.to_payload() if isinstance(research_overview, ResearchOverviewResult) else research_overview
        return {"researchOverview": overview_payload, "evidence": evidence, "concepts": concepts,
                "methods": methods, "findings": findings, "relationCandidates": []}

    def _entity_payloads(self, entity_type: str, paper_id: str, items: list[ExtractedItem], evidence_refs: dict[str, str]) -> list[dict[str, object]]:
        payloads: list[dict[str, object]] = []
        for index, item in enumerate(items):
            normalized = self._normalizer.normalize(self._raw_entity(item, entity_type, evidence_refs))  # type: ignore[arg-type]
            if normalized.status == "matched":
                continue
            payload = self._entity_payload(entity_type, paper_id, index, item, normalized)
            payloads.append(payload)
        return payloads

    @staticmethod
    def _entity_payload(entity_type: str, paper_id: str, index: int, item: ExtractedItem, normalized: NormalizedEntity) -> dict[str, object]:
        base = {
            "clientRef": _client_ref(entity_type, paper_id, index, item.source_term or item.display or ""),
            "rawText": item.source_term or item.display or "",
            "normalizedLabel": normalized.canonical_name or item.normalized or item.display or "",
            "matchStatus": normalized.status,
            "candidates": _review_candidates(entity_type, paper_id, index, normalized),
            "extractionConfidence": item.confidence,
            "evidenceRefs": normalized.evidence_client_refs,
        }
        if entity_type == "method":
            return {**base, "methodType": item.method_type, "description": None}
        return base

    @staticmethod
    def _finding_payload(paper_id: str, index: int, item: ExtractedItem, evidence_refs: dict[str, str]) -> dict[str, object]:
        return {"clientRef": _client_ref("finding", paper_id, index, item.text or ""), "statement": item.text or "",
                "confidence": item.confidence, "evidenceRefs": [evidence_refs[evidence.id] for evidence in item.evidence]}

    @staticmethod
    def _raw_entity(item: ExtractedItem, entity_type: str, evidence_refs: dict[str, str]) -> RawEntity:
        source_term, display_name = item.source_term or "", item.normalized or item.display or ""
        if not source_term or not display_name:
            raise ValueError("Concept and Method extraction requires sourceTerm and normalized/display name")
        context = "\n".join(evidence.text for evidence in item.evidence)
        return RawEntity(source_term, display_name, entity_type, context or None,
                         [evidence_refs[evidence.id] for evidence in item.evidence])  # type: ignore[arg-type]

    @staticmethod
    def _evidence_payload(extraction: StructuredPaperExtraction) -> tuple[list[dict[str, object]], dict[str, str]]:
        seen: dict[str, Evidence] = {}
        for item in [*extraction.concepts, *extraction.methods, *extraction.findings]:
            for evidence in item.evidence:
                seen[evidence.id] = evidence
        references, payload = {}, []
        for evidence_id, evidence in seen.items():
            client_ref = _client_ref("evidence", extraction.paper_id, 0, f"{evidence.section}:{evidence.text}")
            references[evidence_id] = client_ref
            payload.append({"clientRef": client_ref, "section": evidence.section, "text": evidence.text})
        return payload, references


def _review_candidates(entity_type: str, paper_id: str, index: int, normalized: NormalizedEntity) -> list[dict[str, object]]:
    by_id = {candidate.entity_id: candidate for candidate in normalized.candidates}
    candidates: list[dict[str, object]] = []
    for candidate_id in normalized.selected_candidate_ids:
        candidate = by_id[candidate_id]
        candidates.append({
            "clientRef": _client_ref(f"{entity_type}_candidate_existing", paper_id, index, candidate.entity_id),
            "kind": "existing", "nodeId": candidate.entity_id, "label": candidate.canonical_name,
            "recommendationScore": normalized.recommendation_scores[candidate.entity_id],
        })
    if normalized.status == "new":
        candidates.append({
            "clientRef": _client_ref(f"{entity_type}_candidate_new", paper_id, index, normalized.canonical_name or ""),
            "kind": "new", "nodeId": None, "label": normalized.canonical_name,
            "recommendationScore": normalized.new_recommendation_score,
        })
    # v0.5 requires score-descending candidates, null last, with stable source order for ties.
    return sorted(candidates, key=lambda candidate: (candidate["recommendationScore"] is None,
                                                      -(candidate["recommendationScore"] or 0)))


def _client_ref(kind: str, paper_id: str, index: int, value: str) -> str:
    digest = sha256(f"{kind}:{paper_id}:{index}:{value}".encode()).hexdigest()[:16]
    return f"{kind}_{digest}"
