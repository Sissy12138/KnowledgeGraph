"""Two-stage, local-only cross-paper relation proposals."""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import json
import math
import re
from typing import Literal

from .model_client import ModelClient
from .paper_extraction import PaperDocument, StructuredPaperExtraction

RelationType = Literal["related_to", "supports", "extends", "contradicts", "none"]


@dataclass(frozen=True)
class RelationCandidate:
    source_paper_id: str
    target_paper_id: str
    score: float
    signals: tuple[str, ...]


@dataclass(frozen=True)
class RelationProposal:
    source_paper_id: str
    target_paper_id: str
    relation_type: RelationType
    confidence: float | None
    reason: str
    source_evidence_client_refs: list[str]
    target_evidence_client_refs: list[str]

    def to_dict(self) -> dict[str, object]:
        return {"sourcePaperId": self.source_paper_id, "targetPaperId": self.target_paper_id,
                "relationType": self.relation_type, "confidence": self.confidence, "reason": self.reason,
                "sourceEvidenceClientRefs": self.source_evidence_client_refs,
                "targetEvidenceClientRefs": self.target_evidence_client_refs}


@dataclass(frozen=True)
class PaperRelationRecord:
    document: PaperDocument
    extraction: StructuredPaperExtraction


class PaperCandidateRetriever:
    """Deterministic Top-K recall only; no relation type is inferred here."""

    def recall(self, source: PaperRelationRecord, corpus: list[PaperRelationRecord], top_k: int = 5) -> list[RelationCandidate]:
        if top_k <= 0:
            raise ValueError("top_k must be positive")
        results = []
        for target in corpus:
            if target.document.paper_id == source.document.paper_id:
                continue
            shared_concepts = _shared_labels(source.extraction.concepts, target.extraction.concepts)
            shared_methods = _shared_labels(source.extraction.methods, target.extraction.methods)
            citation = _citation_clue(source.document, target.document)
            similarity = _similarity(_paper_text(source.document), _paper_text(target.document))
            score = min(1.0, 0.35 * bool(shared_concepts) + 0.3 * bool(shared_methods) + 0.25 * citation + 0.1 * similarity)
            if score:
                signals = tuple(name for name, active in (("sharedConcept", bool(shared_concepts)), ("sharedMethod", bool(shared_methods)),
                                                           ("citationClue", citation > 0), ("titleAbstractSimilarity", similarity > 0)) if active)
                results.append(RelationCandidate(source.document.paper_id, target.document.paper_id, score, signals))
        return sorted(results, key=lambda item: (-item.score, item.target_paper_id))[:top_k]


class RelationJudge:
    """Judges only recalled pairs. Strong relations require evidence from both papers."""

    def __init__(self, mode: Literal["mock", "live"], client: ModelClient | None = None) -> None:
        if mode == "live" and client is None:
            raise ValueError("live relation judgment requires a model client")
        self._mode, self._client = mode, client

    def judge(self, source: PaperRelationRecord, target: PaperRelationRecord) -> RelationProposal:
        source_refs, target_refs = _evidence_refs(source), _evidence_refs(target)
        if self._mode == "mock":
            relation = "related_to" if source_refs and target_refs else "none"
            return RelationProposal(source.document.paper_id, target.document.paper_id, relation, 0.5 if relation != "none" else None,
                                    "离线 mock：仅作为关系评估流程占位。", source_refs[:2] if relation != "none" else [], target_refs[:2] if relation != "none" else [])
        assert self._client is not None
        prompt = _prompt(source, target)
        raw = self._client.generate("Return valid JSON only.", prompt)
        try:
            decision = _parse(raw)
        except (ValueError, json.JSONDecodeError):
            decision = _parse(self._client.generate("Return valid JSON only.", f"Repair exact JSON only.\n{prompt}\nInvalid:\n{raw}"))
        relation, confidence, reason = decision["relationType"], decision["confidence"], decision["reason"]
        if relation != "none" and (not source_refs or not target_refs):
            raise ValueError("relation proposal requires evidence from both papers")
        return RelationProposal(source.document.paper_id, target.document.paper_id, relation, confidence, reason,
                                source_refs[:3] if relation != "none" else [], target_refs[:3] if relation != "none" else [])


def _shared_labels(left, right) -> set[str]:
    return {_term(item) for item in left if _term(item)} & {_term(item) for item in right if _term(item)}


def _term(item) -> str:
    return re.sub(r"\W+", "", (item.normalized or item.display or item.source_term or "").casefold())


def _citation_clue(source: PaperDocument, target: PaperDocument) -> float:
    target_doi = target.doi.casefold() if target.doi else ""
    target_title = (target.title or "").casefold()
    references = " ".join(reference.raw_text.casefold() for reference in source.references)
    return float(bool((target_doi and target_doi in references) or (target_title and target_title in references)))


def _paper_text(document: PaperDocument) -> str:
    return f"{document.title or ''} {document.abstract or ''}".casefold()


def _similarity(left: str, right: str) -> float:
    a, b = set(re.findall(r"[a-z0-9]+", left)), set(re.findall(r"[a-z0-9]+", right))
    return len(a & b) / math.sqrt(len(a) * len(b)) if a and b else 0.0


def _evidence_refs(record: PaperRelationRecord) -> list[str]:
    refs = []
    for item in [*record.extraction.concepts, *record.extraction.methods, *record.extraction.findings]:
        for evidence in item.evidence:
            digest = sha256(f"evidence:{record.document.paper_id}:0:{evidence.section}:{evidence.text}".encode()).hexdigest()[:16]
            refs.append(f"evidence_{digest}")
    return list(dict.fromkeys(refs))


def _prompt(source: PaperRelationRecord, target: PaperRelationRecord) -> str:
    return ("Judge only this recalled pair. Return related_to, supports, extends, contradicts, or none. "
            "Do not infer a strong relation from shared terms alone. Any non-none relation requires evidence from both papers. "
            "Return exactly {relationType, confidence, reason}. Chinese reason.\nSOURCE=" + _paper_text(source.document) + "\nTARGET=" + _paper_text(target.document))


def _parse(value: str) -> dict[str, object]:
    parsed = json.loads(value)
    if not isinstance(parsed, dict) or set(parsed) != {"relationType", "confidence", "reason"}:
        raise ValueError("invalid relation judgment JSON")
    if parsed["relationType"] not in {"related_to", "supports", "extends", "contradicts", "none"}:
        raise ValueError("unsupported relation type")
    if parsed["confidence"] is not None and (not isinstance(parsed["confidence"], (int, float)) or not 0 <= parsed["confidence"] <= 1):
        raise ValueError("invalid relation confidence")
    if not isinstance(parsed["reason"], str) or not parsed["reason"].strip():
        raise ValueError("relation reason is required")
    return parsed
