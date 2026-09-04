"""Conservative paper-level ResearchOverview derived from verified extraction."""

from __future__ import annotations

from dataclasses import dataclass
import re

from .models import Evidence
from .paper_extraction import ExtractedItem, PaperDocument, StructuredPaperExtraction


_SAMPLE_PATTERNS = (
    (re.compile(r"\b(?:N|n)\s*=\s*(\d+)\s+(?:healthy\s+)?(?:human\s+)?participants\b", re.IGNORECASE), "人类被试"),
    (re.compile(r"\b(\d+)\s+(?:healthy\s+)?(?:human\s+)?participants\b", re.IGNORECASE), "人类被试"),
    (re.compile(r"\b(?:N|n)\s*=\s*(\d+)\s+(mice|rats)\b", re.IGNORECASE), None),
    (re.compile(r"\b(\d+)\s+(mice|rats)\b", re.IGNORECASE), None),
)
_ANIMALS = {"mice": "小鼠", "rats": "大鼠"}


@dataclass(frozen=True)
class ResearchOverviewResult:
    """Five-field submission payload plus internal, evidence-backed provenance."""

    research_topics: list[str]
    research_question: str | None
    sample: str | None
    methods: str | None
    main_results: str | None
    evidence_by_field: dict[str, list[Evidence]]

    def to_payload(self) -> dict[str, object]:
        return {
            "researchTopics": self.research_topics,
            "researchQuestion": self.research_question,
            "sample": self.sample,
            "methods": self.methods,
            "mainResults": self.main_results,
        }


class ResearchOverviewBuilder:
    """Reuses extraction outputs and only scans source text for explicit sample statements."""

    def build(self, document: PaperDocument, extraction: StructuredPaperExtraction) -> ResearchOverviewResult:
        topics, topic_evidence = _labels(extraction.concepts, limit=5)
        question, question_evidence = _first_text(extraction.research_questions)
        methods, method_evidence = _joined_labels(extraction.methods, limit=3)
        results, result_evidence = _joined_text(extraction.findings, limit=3)
        sample, sample_evidence = _explicit_sample(document)
        return ResearchOverviewResult(
            research_topics=topics,
            research_question=question,
            sample=sample,
            methods=methods,
            main_results=results,
            evidence_by_field={
                "researchTopics": topic_evidence,
                "researchQuestion": question_evidence,
                "sample": sample_evidence,
                "methods": method_evidence,
                "mainResults": result_evidence,
            },
        )


def _labels(items: list[ExtractedItem], limit: int) -> tuple[list[str], list[Evidence]]:
    labels, evidence = [], []
    seen: set[str] = set()
    for item in items:
        label = item.normalized or item.display
        if not label or label in seen:
            continue
        seen.add(label)
        labels.append(label)
        evidence.extend(item.evidence)
        if len(labels) == limit:
            break
    return labels, _unique_evidence(evidence)


def _joined_labels(items: list[ExtractedItem], limit: int) -> tuple[str | None, list[Evidence]]:
    labels, evidence = _labels(items, limit)
    return ("；".join(labels) if labels else None), evidence


def _first_text(items: list[ExtractedItem]) -> tuple[str | None, list[Evidence]]:
    for item in items:
        if item.text and item.text.strip():
            return item.text, list(item.evidence)
    return None, []


def _joined_text(items: list[ExtractedItem], limit: int) -> tuple[str | None, list[Evidence]]:
    texts, evidence = [], []
    for item in items:
        if item.text and item.text.strip() and item.text not in texts:
            texts.append(item.text)
            evidence.extend(item.evidence)
            if len(texts) == limit:
                break
    return ("；".join(texts) if texts else None), _unique_evidence(evidence)


def _explicit_sample(document: PaperDocument) -> tuple[str | None, list[Evidence]]:
    for index, chunk in enumerate(document.chunks):
        if not any(token in chunk.section.casefold() for token in ("method", "material", "participant", "sample", "abstract")):
            continue
        for pattern, fixed_label in _SAMPLE_PATTERNS:
            match = pattern.search(chunk.chunk_text)
            if not match:
                continue
            count = match.group(1)
            label = fixed_label or _ANIMALS[match.group(2).casefold()]
            evidence = chunk.as_document_chunk(document.paper_id, index).evidence_for(match.group(0))
            return f"{label}（n={count}）", [evidence]
    return None, []


def _unique_evidence(evidence: list[Evidence]) -> list[Evidence]:
    seen: dict[str, Evidence] = {}
    for item in evidence:
        seen[item.id] = item
    return list(seen.values())
