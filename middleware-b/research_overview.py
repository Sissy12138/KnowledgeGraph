"""Conservative paper-level ResearchOverview derived from verified extraction."""

from __future__ import annotations

from dataclasses import dataclass
import json
import re
from typing import Any, Callable

from .agent_prompts import overview
from .agent_prompts.common import GLOBAL_GUARDRAILS
from .model_client import ModelCallError, ModelClient
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
        original_topics = _original_texts(self.evidence_by_field.get("researchTopics", []))
        original = {
            "researchTopics": original_topics,
            "researchQuestion": _joined_original(self.evidence_by_field.get("researchQuestion", [])),
            "sample": _joined_original(self.evidence_by_field.get("sample", [])),
            "methods": _joined_original(self.evidence_by_field.get("methods", [])),
            "mainResults": _joined_original(self.evidence_by_field.get("mainResults", [])),
        }
        return {
            "researchTopics": self.research_topics,
            "researchQuestion": self.research_question,
            "sample": self.sample,
            "methods": self.methods,
            "mainResults": self.main_results,
            "original": original if any(
                value for key, value in original.items() if key != "researchTopics"
            ) or bool(original_topics) else None,
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


class LiveResearchOverviewExtractor:
    """Extract the five-field overview in one evidence-backed model pass.

    This runs alongside entity extraction because a research overview needs
    cross-section context.  If the model response is malformed, the caller can
    safely fall back to ``ResearchOverviewBuilder`` rather than losing a paper.
    """

    def __init__(
        self,
        client: ModelClient,
        progress: Callable[[int, str], None] | None = None,
    ) -> None:
        self._client = client
        self._progress = progress

    def extract(self, document: PaperDocument, fallback: StructuredPaperExtraction) -> ResearchOverviewResult:
        chunks = self._select_chunks(document.chunks)
        if not chunks:
            return ResearchOverviewBuilder().build(document, fallback)
        partials: list[ResearchOverviewResult] = []
        total_batches = max(1, (len(chunks) + 7) // 8)
        for batch_index, start in enumerate(range(0, len(chunks), 8), start=1):
            batch = chunks[start:start + 8]
            prompt = self._render_prompt(document, batch)
            try:
                raw = self._parse(self._client.generate("Return only valid JSON.", prompt))
                partials.append(self._to_result(document, batch, fallback, raw))
            except (ModelCallError, ValueError, json.JSONDecodeError, KeyError, TypeError):
                continue
            finally:
                if self._progress is not None:
                    self._progress(72 + round(8 * batch_index / total_batches), f"提取研究概览 {batch_index}/{total_batches}")
        if not partials:
            return ResearchOverviewBuilder().build(document, fallback)
        return self._merge_results(document, fallback, partials)

    @staticmethod
    def _select_chunks(chunks: list[PaperChunk]) -> list[PaperChunk]:
        candidates = [
            chunk for chunk in chunks
            if "reference" not in chunk.section.casefold()
            and "bibliograph" not in chunk.section.casefold()
        ]
        sample_cue = re.compile(r"\b(?:participants?|subjects?|patients?|mice|rats|sample|cohort|n\s*=)\b", re.IGNORECASE)
        result_cue = re.compile(r"\b(?:we\s+(?:found|observed|show|demonstrate)|results?\s+(?:show|indicate))\b", re.IGNORECASE)

        def score(chunk: PaperChunk) -> tuple[int, int]:
            section = chunk.section.casefold()
            value = 0
            if "abstract" in section:
                value += 10
            if any(token in section for token in ("participant", "sample", "subject")):
                value += 8
            elif any(token in section for token in ("method", "material")):
                value += 3
            if any(token in section for token in ("result", "finding", "conclusion")):
                value += 5
            elif any(token in section for token in ("introduction", "discussion")):
                value += 2
            if sample_cue.search(chunk.chunk_text):
                value += 4
            if result_cue.search(chunk.chunk_text):
                value += 4
            return value, -chunks.index(chunk)

        ranked = sorted(candidates, key=score, reverse=True)
        selected = [chunk for chunk in ranked if score(chunk)[0] >= 5]
        if selected:
            return selected
        return ranked[:1]

    @staticmethod
    def _render_prompt(document: PaperDocument, chunks: list[PaperChunk]) -> str:
        source_chunks = [{"chunkId": chunk.chunk_id, "section": chunk.section, "text": chunk.chunk_text} for chunk in chunks]
        return (
            GLOBAL_GUARDRAILS.format(max_items=3)
            + "\n\n【当前任务】\n" + overview.INSTRUCTION
            + "\n\n【严格输出 JSON 模板】\n" + json.dumps(overview.OUTPUT_TEMPLATE, ensure_ascii=False)
            + "\n仅输出 JSON 对象，不得添加字段。null 字段的 evidenceRefs 使用空数组。"
            + f"\n\n【论文标题】\n{document.title or ''}\n【允许引用的原文块】\n"
            + json.dumps(source_chunks, ensure_ascii=False)
        )

    @staticmethod
    def _parse(value: str) -> dict[str, Any]:
        value = value.strip()
        if value.startswith("```"):
            value = value.split("\n", 1)[1].rsplit("```", 1)[0].strip()
        parsed = json.loads(value)
        if not isinstance(parsed, dict):
            raise ValueError("research overview response must be an object")
        return parsed

    def _to_result(self, document: PaperDocument, chunks: list[PaperChunk], fallback: StructuredPaperExtraction, raw: dict[str, Any]) -> ResearchOverviewResult:
        chunk_map = {chunk.chunk_id: (index, chunk) for index, chunk in enumerate(chunks)}
        question, question_evidence = self._single(raw.get("researchQuestion"), document.paper_id, chunk_map)
        sample, sample_evidence = self._single(raw.get("sample"), document.paper_id, chunk_map)
        methods, method_evidence = self._many(raw.get("methods"), document.paper_id, chunk_map)
        results, result_evidence = self._many(raw.get("mainResults"), document.paper_id, chunk_map)
        topics, topic_evidence = _labels(fallback.concepts, limit=5)
        return ResearchOverviewResult(
            research_topics=topics,
            research_question=question,
            sample=sample,
            methods="；".join(methods) if methods else None,
            main_results="；".join(results) if results else None,
            evidence_by_field={
                "researchTopics": topic_evidence,
                "researchQuestion": question_evidence,
                "sample": sample_evidence,
                "methods": method_evidence,
                "mainResults": result_evidence,
            },
        )

    @staticmethod
    def _merge_results(
        document: PaperDocument,
        fallback: StructuredPaperExtraction,
        partials: list[ResearchOverviewResult],
    ) -> ResearchOverviewResult:
        deterministic = ResearchOverviewBuilder().build(document, fallback)

        def first(field: str) -> tuple[str | None, list[Evidence]]:
            for partial in partials:
                value = getattr(partial, field)
                if value:
                    evidence_key = {
                        "research_question": "researchQuestion",
                        "sample": "sample",
                    }[field]
                    return value, partial.evidence_by_field[evidence_key]
            evidence_key = {
                "research_question": "researchQuestion",
                "sample": "sample",
            }[field]
            return getattr(deterministic, field), deterministic.evidence_by_field[evidence_key]

        def merged_many(field: str, evidence_key: str) -> tuple[str | None, list[Evidence]]:
            values: list[str] = []
            evidence: list[Evidence] = []
            for partial in partials:
                value = getattr(partial, field)
                if not value:
                    continue
                for item in value.split("；"):
                    if item and item not in values and len(values) < 3:
                        values.append(item)
                evidence.extend(partial.evidence_by_field[evidence_key])
            if values:
                return "；".join(values), _unique_evidence(evidence)
            return getattr(deterministic, field), deterministic.evidence_by_field[evidence_key]

        question, question_evidence = first("research_question")
        sample, sample_evidence = first("sample")
        methods, method_evidence = merged_many("methods", "methods")
        results, result_evidence = merged_many("main_results", "mainResults")
        return ResearchOverviewResult(
            research_topics=deterministic.research_topics,
            research_question=question,
            sample=sample,
            methods=methods,
            main_results=results,
            evidence_by_field={
                "researchTopics": deterministic.evidence_by_field["researchTopics"],
                "researchQuestion": question_evidence,
                "sample": sample_evidence,
                "methods": method_evidence,
                "mainResults": result_evidence,
            },
        )

    def _single(self, value: object, paper_id: str, chunk_map: dict[str, tuple[int, PaperChunk]]) -> tuple[str | None, list[Evidence]]:
        if value is None:
            return None, []
        if not isinstance(value, dict):
            return None, []
        text, evidence = self._item(value, paper_id, chunk_map)
        return text, evidence

    def _many(self, value: object, paper_id: str, chunk_map: dict[str, tuple[int, PaperChunk]]) -> tuple[list[str], list[Evidence]]:
        if not isinstance(value, list):
            return [], []
        texts: list[str] = []
        evidence: list[Evidence] = []
        for item in value[:3]:
            if not isinstance(item, dict):
                continue
            text, item_evidence = self._item(item, paper_id, chunk_map)
            if text and text not in texts:
                texts.append(text)
                evidence.extend(item_evidence)
        return texts, _unique_evidence(evidence)

    @staticmethod
    def _item(value: dict[str, Any], paper_id: str, chunk_map: dict[str, tuple[int, PaperChunk]]) -> tuple[str | None, list[Evidence]]:
        text, refs = value.get("value"), value.get("evidenceRefs")
        if not isinstance(text, str) or not text.strip() or not isinstance(refs, list) or not refs:
            return None, []
        evidence: list[Evidence] = []
        for ref in refs:
            if not isinstance(ref, dict) or not isinstance(ref.get("chunkId"), str) or not isinstance(ref.get("text"), str):
                return None, []
            source = chunk_map.get(ref["chunkId"])
            if not source:
                return None, []
            index, chunk = source
            try:
                evidence.append(chunk.as_document_chunk(paper_id, index).evidence_for(ref["text"]))
            except ValueError:
                return None, []
        return text.strip(), _unique_evidence(evidence)


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


def _original_texts(evidence: list[Evidence]) -> list[str]:
    """Return deduplicated, verbatim source excerpts in document order."""
    return list(dict.fromkeys(item.text.strip() for item in evidence if item.text.strip()))


def _joined_original(evidence: list[Evidence]) -> str | None:
    texts = _original_texts(evidence)
    return "\n\n".join(texts) if texts else None


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
