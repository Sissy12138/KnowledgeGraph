"""Aggregate existing B outputs into local-only new-paper knowledge update proposals."""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import re

from .cross_paper_relations import RelationProposal
from .paper_extraction import PaperDocument, StructuredPaperExtraction


@dataclass(frozen=True)
class KnowledgeUpdateProposal:
    type: str
    target: dict[str, object]
    priority: int
    confidence: float | None
    reason: str
    evidence_client_refs: list[str]

    def to_dict(self) -> dict[str, object]:
        return {"type": self.type, "target": self.target, "priority": self.priority, "confidence": self.confidence,
                "reason": self.reason, "evidenceClientRefs": self.evidence_client_refs}


@dataclass(frozen=True)
class ExistingPaperKnowledge:
    document: PaperDocument
    extraction: StructuredPaperExtraction


class KnowledgeUpdatePlanner:
    """Never calls a model or mutates storage; it only aggregates verified prior outputs."""

    def propose(self, document: PaperDocument, extraction: StructuredPaperExtraction, entity_result: dict[str, object],
                existing: list[ExistingPaperKnowledge], relations: list[RelationProposal]) -> list[KnowledgeUpdateProposal]:
        duplicate = _duplicate(document, existing)
        if duplicate:
            return [KnowledgeUpdateProposal("duplicate_paper", {"paperId": duplicate.document.paper_id}, 1, 0.99,
                                            "DOI 或规范化标题与已有论文一致。", [])]
        proposals = self._entity_proposals(document.paper_id, entity_result)
        proposals.extend(_relation_proposals(relations, document.paper_id))
        proposals.extend(_finding_conflicts(document.paper_id, extraction, existing))
        return sorted(proposals, key=lambda item: (item.priority, -(item.confidence or 0), item.type))

    @staticmethod
    def _entity_proposals(paper_id: str, result: dict[str, object]) -> list[KnowledgeUpdateProposal]:
        output: list[KnowledgeUpdateProposal] = []
        for kind, proposal_type in (("concepts", "new_concept"), ("methods", "new_method")):
            entries = result.get(kind, [])
            if not isinstance(entries, list):
                continue
            for entry in entries:
                if not isinstance(entry, dict):
                    continue
                candidates, refs = entry.get("candidates"), entry.get("evidenceRefs")
                if not isinstance(candidates, list) or not isinstance(refs, list):
                    continue
                confidence = entry.get("extractionConfidence") if _score(entry.get("extractionConfidence")) else None
                new = [candidate for candidate in candidates if isinstance(candidate, dict) and candidate.get("kind") == "new"]
                existing = [candidate for candidate in candidates if isinstance(candidate, dict) and candidate.get("kind") == "existing"]
                if new:
                    output.append(KnowledgeUpdateProposal(proposal_type, {"label": new[0].get("label"), "paperId": paper_id}, 3, confidence,
                                                           "现有实体审核结果包含 New 候选。", list(refs)))
                for candidate in existing:
                    output.append(KnowledgeUpdateProposal("add_existing_entity_evidence", {"nodeId": candidate.get("nodeId"), "entityType": kind[:-1], "paperId": paper_id},
                                                           5, confidence, "论文为已有实体提供新的原文证据。", list(refs)))
        return output


def _duplicate(document: PaperDocument, existing: list[ExistingPaperKnowledge]) -> ExistingPaperKnowledge | None:
    doi, title = (document.doi or "").casefold(), _norm(document.title or "")
    for item in existing:
        if doi and doi == (item.document.doi or "").casefold():
            return item
        if title and title == _norm(item.document.title or ""):
            return item
    return None


def _relation_proposals(relations: list[RelationProposal], paper_id: str) -> list[KnowledgeUpdateProposal]:
    output = []
    for relation in relations:
        if relation.source_paper_id != paper_id or relation.relation_type == "none":
            continue
        refs = [*relation.source_evidence_client_refs, *relation.target_evidence_client_refs]
        if refs:
            output.append(KnowledgeUpdateProposal("new_paper_relation", {"sourcePaperId": paper_id, "targetPaperId": relation.target_paper_id,
                "relationType": relation.relation_type}, 4, relation.confidence, relation.reason, refs))
    return output


def _finding_conflicts(paper_id: str, extraction: StructuredPaperExtraction, existing: list[ExistingPaperKnowledge]) -> list[KnowledgeUpdateProposal]:
    output = []
    for finding in extraction.findings:
        if not finding.text:
            continue
        for prior in existing:
            for previous in prior.extraction.findings:
                if previous.text and _opposes(finding.text, previous.text):
                    output.append(KnowledgeUpdateProposal("finding_conflict", {"paperId": prior.document.paper_id, "statement": previous.text}, 2,
                        min(finding.confidence or 0.5, previous.confidence or 0.5), "两个 Finding 讨论相同关键词但极性相反。", _refs(finding)))
    return output


def _opposes(left: str, right: str) -> bool:
    tokens_left, tokens_right = set(re.findall(r"[a-z]+", left.casefold())), set(re.findall(r"[a-z]+", right.casefold()))
    neg_left, neg_right = bool(tokens_left & {"not", "no", "decrease", "reduced", "lower"}), bool(tokens_right & {"not", "no", "decrease", "reduced", "lower"})
    return bool(tokens_left & tokens_right) and neg_left != neg_right


def _refs(item) -> list[str]:
    return [f"evidence_{sha256(f'evidence:{e.paper_id}:0:{e.section}:{e.text}'.encode()).hexdigest()[:16]}" for e in item.evidence]


def _score(value: object) -> bool:
    return isinstance(value, (int, float)) and not isinstance(value, bool) and 0 <= value <= 1


def _norm(value: str) -> str:
    return re.sub(r"\W+", "", value.casefold())
