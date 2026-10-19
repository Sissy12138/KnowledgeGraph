"""Single-paper knowledge extraction using either offline or live agents."""

from __future__ import annotations

from dataclasses import dataclass, field
from hashlib import sha256
import json
import re
from typing import Any, Callable, Literal

from .agent_prompts import concept, finding, method, research_question
from .agent_prompts.common import GLOBAL_GUARDRAILS
from .document import DocumentChunk
from .model_client import ModelCallError, ModelClient
from .models import Evidence, Suggestion

ExtractionMode = Literal["mock", "live"]
ALLOWED_METHOD_TYPES = {
    "behavioralTask", "electrophysiology", "imaging", "intervention", "molecularCellular",
    "computationalModel", "statisticalAnalysis", "other",
}
METHOD_BATCH_CHUNKS = 8
CONCEPT_BATCH_CHUNKS = 8
MAX_CONCEPTS_PER_PAPER = 6
MAX_METHODS_PER_PAPER = 6

_STRONG_CONCEPT_CUE = re.compile(
    r"\b(?:we\s+(?:define|call|introduce|propose)|is\s+defined\s+as|"
    r"referred\s+to\s+as|denoted\s+as|conceptualized\s+as)\b",
    re.IGNORECASE,
)
_CONCEPT_CUE = re.compile(
    r"\b(?:concept|construct|mechanism|phenomenon|theory|framework|state|representation)\b",
    re.IGNORECASE,
)
_METHOD_USE_CUE = re.compile(
    r"\b(?:we\s+(?:use|used|apply|applied|fit|fitted|train|trained|evaluate|evaluated|"
    r"measure|measured|record|recorded|estimate|estimated|implement|implemented)|"
    r"using|was\s+(?:used|applied|fitted|trained|measured|recorded|estimated|implemented))\b",
    re.IGNORECASE,
)
_METHOD_SECTION_TOKENS = (
    "method", "material", "procedure", "experiment", "data generation",
    "implementation", "training", "evaluation setup", "study design", "apparatus",
)
_METHOD_LOW_SIGNAL_SECTION_TOKENS = (
    "result", "discussion", "conclusion", "impact", "limitation", "other task",
    "parameter setting", "quality assurance", "quality control",
)
_GENERIC_ENTITY_KEYS = {
    "analysis", "approach", "data", "dataset", "experiment", "group", "method", "model",
    "result", "task", "process", "procedure", "pipeline", "sample", "system", "user",
    "分析", "方法", "模型", "结果", "任务", "流程", "过程", "群体", "样本", "系统", "用户",
}


def _is_method_section_name(section: str) -> bool:
    folded = section.casefold()
    return any(token in folded for token in _METHOD_SECTION_TOKENS)


@dataclass(frozen=True)
class PaperChunk:
    section: str
    chunk_id: str
    chunk_text: str
    page: int | None = None
    position: dict[str, int] | None = None

    def as_document_chunk(self, paper_id: str, index: int) -> DocumentChunk:
        return DocumentChunk(self.chunk_id, paper_id, self.section, index, self.chunk_text)


@dataclass(frozen=True)
class PaperDocument:
    paper_id: str
    metadata: dict[str, object]
    chunks: list[PaperChunk]
    sections: list["PaperSection"] = field(default_factory=list)
    references: list["PaperReference"] = field(default_factory=list)

    @property
    def title(self) -> str | None:
        value = self.metadata.get("title")
        return value if isinstance(value, str) and value.strip() else None

    @property
    def authors(self) -> list[str]:
        value = self.metadata.get("authors")
        return list(value) if isinstance(value, list) and all(isinstance(author, str) for author in value) else []

    @property
    def year(self) -> int | None:
        value = self.metadata.get("year")
        return value if isinstance(value, int) else None

    @property
    def doi(self) -> str | None:
        value = self.metadata.get("doi")
        return value if isinstance(value, str) and value.strip() else None

    @property
    def abstract(self) -> str | None:
        value = self.metadata.get("abstract")
        return value if isinstance(value, str) and value.strip() else None

    @property
    def keywords(self) -> list[str]:
        value = self.metadata.get("keywords")
        return list(value) if isinstance(value, list) and all(isinstance(keyword, str) for keyword in value) else []

    @classmethod
    def from_dict(cls, value: dict[str, object]) -> "PaperDocument":
        paper_id = value.get("paper_id", value.get("paperId"))
        metadata = value.get("metadata")
        chunks = value.get("chunks")
        if not isinstance(paper_id, str) or not isinstance(metadata, dict) or not isinstance(chunks, list):
            raise ValueError("PaperDocument requires paper_id, metadata, and chunks")
        parsed_chunks: list[PaperChunk] = []
        for chunk in chunks:
            if not isinstance(chunk, dict):
                raise ValueError("every paper chunk must be an object")
            section = chunk.get("section")
            chunk_id = chunk.get("chunk_id", chunk.get("chunkId"))
            chunk_text = chunk.get("chunk_text", chunk.get("text"))
            if not all(isinstance(item, str) and item.strip() for item in (section, chunk_id, chunk_text)):
                raise ValueError("every chunk requires non-empty section, chunk_id, and chunk_text")
            page, position = chunk.get("page"), chunk.get("position")
            if page is not None and (not isinstance(page, int) or page < 1):
                raise ValueError("chunk.page must be a positive integer when supplied")
            if position is not None and (not isinstance(position, dict) or not all(isinstance(item, int) for item in position.values())):
                raise ValueError("chunk.position must be an integer mapping when supplied")
            parsed_chunks.append(PaperChunk(section, chunk_id, chunk_text, page, position))
        parsed_sections = [PaperSection.from_dict(section) for section in value.get("sections", [])] if isinstance(value.get("sections", []), list) else []
        parsed_references = [PaperReference.from_dict(reference) for reference in value.get("references", [])] if isinstance(value.get("references", []), list) else []
        return cls(paper_id, metadata, parsed_chunks, parsed_sections, parsed_references)

    def to_dict(self) -> dict[str, object]:
        """Serialize the PDF-facing document contract without changing extraction inputs."""
        return {
            "paperId": self.paper_id,
            "title": self.title,
            "authors": self.authors,
            "year": self.year,
            "doi": self.doi,
            "abstract": self.abstract,
            "keywords": self.keywords,
            "sections": [section.to_dict() for section in self.sections],
            "chunks": [
                {
                    "chunkId": chunk.chunk_id,
                    "section": chunk.section,
                    "text": chunk.chunk_text,
                    "page": chunk.page,
                    "position": chunk.position,
                }
                for chunk in self.chunks
            ],
            "references": [reference.to_dict() for reference in self.references],
        }


@dataclass(frozen=True)
class PaperSection:
    name: str
    text: str
    page_start: int | None = None
    page_end: int | None = None

    @classmethod
    def from_dict(cls, value: object) -> "PaperSection":
        if not isinstance(value, dict):
            raise ValueError("every section must be an object")
        name, text = value.get("name"), value.get("text")
        if not isinstance(name, str) or not name.strip() or not isinstance(text, str):
            raise ValueError("every section requires name and text")
        return cls(name, text, value.get("pageStart"), value.get("pageEnd"))

    def to_dict(self) -> dict[str, object]:
        return {"name": self.name, "text": self.text, "pageStart": self.page_start, "pageEnd": self.page_end}


@dataclass(frozen=True)
class PaperReference:
    raw_text: str
    doi: str | None = None

    @classmethod
    def from_dict(cls, value: object) -> "PaperReference":
        if not isinstance(value, dict) or not isinstance(value.get("rawText"), str):
            raise ValueError("every reference requires rawText")
        doi = value.get("doi")
        if doi is not None and not isinstance(doi, str):
            raise ValueError("reference.doi must be a string when supplied")
        return cls(value["rawText"], doi)

    def to_dict(self) -> dict[str, object]:
        return {"rawText": self.raw_text, "doi": self.doi}


@dataclass(frozen=True)
class ExtractedItem:
    source_term: str | None
    text: str | None
    display: str | None
    normalized: str | None
    method_type: str | None
    reason: str
    confidence: float | None
    evidence_ids: list[str]
    evidence: list[Evidence] = field(repr=False)

    def to_dict(self) -> dict[str, object]:
        output: dict[str, object] = {"confidence": self.confidence, "evidence_ids": self.evidence_ids}
        if self.source_term is not None:
            output["source_term"] = self.source_term
        if self.text is not None:
            output["text"] = self.text
        if self.display is not None:
            output["display"] = self.display
        if self.normalized is not None:
            output["normalized"] = self.normalized
        if self.method_type is not None:
            output["method_type"] = self.method_type
        return output


@dataclass(frozen=True)
class StructuredPaperExtraction:
    paper_id: str
    research_questions: list[ExtractedItem]
    concepts: list[ExtractedItem]
    methods: list[ExtractedItem]
    findings: list[ExtractedItem]
    agent_errors: dict[str, str]

    def to_dict(self) -> dict[str, object]:
        return {
            "research_questions": [item.to_dict() for item in self.research_questions],
            "concepts": [item.to_dict() for item in self.concepts],
            "methods": [item.to_dict() for item in self.methods],
            "findings": [item.to_dict() for item in self.findings],
        }

    def to_suggestions(self) -> list[Suggestion]:
        """Convert only evidence-verified entity results to the existing Suggestion schema."""
        suggestions: list[Suggestion] = []
        category_action = {"concepts": "addConcept", "methods": "addMethod", "findings": "addFinding"}
        for category, action in category_action.items():
            for index, item in enumerate(getattr(self, category)):
                digest = sha256(f"{self.paper_id}:{category}:{index}:{item.evidence_ids}".encode()).hexdigest()[:16]
                if action == "addConcept":
                    change = {"name": item.display, "sourceTerm": item.source_term, "normalizedName": item.normalized}
                elif action == "addMethod":
                    change = {"name": item.display, "sourceTerm": item.source_term, "normalizedName": item.normalized, "methodType": item.method_type}
                else:
                    change = {"statement": item.text, "sourceTerm": item.source_term}
                suggestions.append(Suggestion(
                    id=f"suggestion_{digest}", paper_id=self.paper_id, action=action, proposed_change=change,
                    reason=item.reason, confidence=item.confidence, evidence=item.evidence,
                ))
        return suggestions


@dataclass(frozen=True)
class _AgentDefinition:
    name: str
    instruction: str
    output_template: dict[str, object]
    max_items: int
    preferred_sections: tuple[str, ...]


_AGENTS = (
    _AgentDefinition("research_questions", research_question.INSTRUCTION, research_question.OUTPUT_TEMPLATE, research_question.MAX_ITEMS, ("abstract", "introduction")),
    _AgentDefinition("concepts", concept.INSTRUCTION, concept.OUTPUT_TEMPLATE, concept.MAX_ITEMS, ()),
    _AgentDefinition("methods", method.INSTRUCTION, method.OUTPUT_TEMPLATE, method.MAX_ITEMS, ("method", "material")),
    _AgentDefinition("findings", finding.INSTRUCTION, finding.OUTPUT_TEMPLATE, finding.MAX_ITEMS, ("result", "finding", "conclusion", "discussion")),
)


class SinglePaperExtractor:
    def __init__(
        self,
        mode: ExtractionMode,
        client: ModelClient | None = None,
        progress: Callable[[int, str], None] | None = None,
    ) -> None:
        if mode == "live" and client is None:
            raise ValueError("live mode requires a model client")
        self._mode = mode
        self._client = client
        self._progress = progress

    def _report(self, value: int, stage: str) -> None:
        if self._progress is not None:
            self._progress(value, stage)

    def extract(self, document: PaperDocument) -> StructuredPaperExtraction:
        if not document.chunks:
            raise ValueError("PaperDocument must contain at least one chunk")
        grouped: dict[str, list[ExtractedItem]] = {agent.name: [] for agent in _AGENTS}
        errors: dict[str, str] = {}
        for agent in _AGENTS:
            try:
                if agent.name == "methods":
                    grouped[agent.name] = self._extract_methods(agent, document)
                elif agent.name == "concepts":
                    grouped[agent.name] = self._extract_concepts(agent, document)
                else:
                    chunks = self._select_chunks(document.chunks, agent.preferred_sections)
                    raw = self._mock_response(agent, chunks) if self._mode == "mock" else self._live_response(agent, document, chunks)
                    grouped[agent.name] = self._validate_items(agent, raw, document, chunks)
                    if agent.name == "research_questions":
                        self._report(57, "提取研究问题")
                    elif agent.name == "findings":
                        self._report(71, "提取主要发现")
            except (ModelCallError, ValueError, json.JSONDecodeError) as error:
                errors[agent.name] = str(error)
        return StructuredPaperExtraction(document.paper_id, grouped["research_questions"], grouped["concepts"], grouped["methods"], grouped["findings"], errors)

    @staticmethod
    def _select_chunks(chunks: list[PaperChunk], preferred_sections: tuple[str, ...]) -> list[PaperChunk]:
        preferred = [chunk for chunk in chunks if any(token in chunk.section.lower() for token in preferred_sections)]
        # Research-question and finding agents retain their bounded legacy context.
        # Concept and method extraction use full batched paths below.
        return (preferred or chunks)[:14]

    def _extract_concepts(self, agent: _AgentDefinition, document: PaperDocument) -> list[ExtractedItem]:
        chunks = self._concept_ranked_chunks(document)
        extracted = self._extract_concept_batches(agent, document, chunks)
        deduplicated = self._deduplicate_concepts(extracted)
        self._report(64, "统一复核核心概念")
        refined = self._refine_concept_boundaries(deduplicated, document)
        # The global adjudicator deliberately assigns the same normalizedName
        # to aliases such as an acronym and its expanded form.  The final pass
        # must therefore merge on that reviewed name rather than the original
        # English surface form used by the pre-review pass.
        final = self._deduplicate_concepts(refined, prefer_normalized=True)
        return self._select_core_entities(final, document, MAX_CONCEPTS_PER_PAPER)

    def _extract_concept_batches(
        self, agent: _AgentDefinition, document: PaperDocument, chunks: list[PaperChunk],
    ) -> list[ExtractedItem]:
        results: list[ExtractedItem] = []
        errors: list[Exception] = []
        total_batches = max(1, (len(chunks) + CONCEPT_BATCH_CHUNKS - 1) // CONCEPT_BATCH_CHUNKS)
        for batch_index, start in enumerate(range(0, len(chunks), CONCEPT_BATCH_CHUNKS), start=1):
            batch = chunks[start:start + CONCEPT_BATCH_CHUNKS]
            if not batch:
                continue
            try:
                raw = self._mock_response(agent, batch) if self._mode == "mock" else self._live_response(agent, document, batch)
                results.extend(self._validate_items(agent, raw, document, batch))
            except (ModelCallError, ValueError, json.JSONDecodeError) as error:
                errors.append(error)
            self._report(58 + round(5 * batch_index / total_batches), f"提取核心概念 {batch_index}/{total_batches}")
        if not results and errors and len(errors) * CONCEPT_BATCH_CHUNKS >= len(chunks):
            raise ValueError(f"all concept extraction batches failed: {errors[-1]}")
        return results

    def _concept_ranked_chunks(self, document: PaperDocument) -> list[PaperChunk]:
        chunks = [chunk for chunk in document.chunks if "reference" not in chunk.section.casefold()]
        terms = self._concept_navigation_terms(document)
        self._report(58, "摘要与关键词导航")

        def score(chunk: PaperChunk) -> tuple[int, int]:
            text = chunk.chunk_text.casefold()
            term_hits = sum(1 for term in terms if term.casefold() in text)
            section = chunk.section.casefold()
            value = term_hits * 2
            if "abstract" in section:
                value += 8
            elif any(token in section for token in ("introduction", "discussion", "conclusion", "result", "finding")):
                value += 1
            if _STRONG_CONCEPT_CUE.search(chunk.chunk_text):
                value += 6
            elif _CONCEPT_CUE.search(chunk.chunk_text):
                value += 3
            return value, -document.chunks.index(chunk)

        # Full-text coverage happens locally: every non-reference chunk is
        # scored, but only definition/keyword/central-section hits are sent to
        # the model. There is no fixed prefix or document-level item cap.
        ranked = sorted(chunks, key=score, reverse=True)
        selected = [chunk for chunk in ranked if score(chunk)[0] >= 5]
        if selected:
            return selected
        abstract = [chunk for chunk in ranked if "abstract" in chunk.section.casefold()]
        if abstract:
            return abstract
        best = score(ranked[0])[0] if ranked else 0
        return [chunk for chunk in ranked if score(chunk)[0] == best]

    def _concept_navigation_terms(self, document: PaperDocument) -> list[str]:
        deterministic = list(dict.fromkeys(keyword.strip() for keyword in document.keywords if keyword.strip()))
        if self._mode == "mock" or self._client is None:
            return deterministic
        section_titles = list(dict.fromkeys(chunk.section for chunk in document.chunks))
        prompt = (
            concept.NAVIGATION_INSTRUCTION
            + "\n\n输出严格 JSON：{\"terms\":[\"English concept search term\"]}。"
            + "\n【标题】\n" + (document.title or "")
            + "\n【Abstract】\n" + (document.abstract or "")
            + "\n【原文 Keywords】\n" + json.dumps(document.keywords, ensure_ascii=False)
            + "\n【章节标题】\n" + json.dumps(section_titles, ensure_ascii=False)
        )
        try:
            parsed = json.loads(self._client.generate("Return valid JSON only.", prompt))
            values = parsed.get("terms") if isinstance(parsed, dict) else None
            if isinstance(values, list):
                model_terms = [value.strip() for value in values if isinstance(value, str) and value.strip()]
                return list(dict.fromkeys([*deterministic, *model_terms]))
        except (ModelCallError, ValueError, json.JSONDecodeError):
            pass
        return deterministic

    def _refine_concept_boundaries(
        self,
        items: list[ExtractedItem],
        document: PaperDocument | None = None,
    ) -> list[ExtractedItem]:
        if self._mode == "mock" or self._client is None or not items:
            return items
        candidates = self._filter_concept_candidates(items, document) if document else items
        if not candidates:
            return []
        payload = [self._adjudication_payload(index, item, document) for index, item in enumerate(candidates)]
        prompt = (
            concept.BOUNDARY_INSTRUCTION
            + "\n这是全篇候选的统一准入裁决；相同概念必须使用同一个 normalizedName。"
            + "\n输出严格 JSON：{\"items\":[{\"candidateIndex\":0,\"keep\":true,"
            "\"sourceTerm\":\"...\",\"displayName\":\"...\",\"normalizedName\":\"...\"}]}。"
            + "\n必须为每个 candidateIndex 返回一次决定。\n【全篇候选】\n"
            + json.dumps(payload, ensure_ascii=False)
        )
        try:
            parsed = json.loads(self._client.generate("Return valid JSON only.", prompt))
            decisions = parsed.get("items") if isinstance(parsed, dict) else None
            if not isinstance(decisions, list):
                raise ValueError("boundary response requires items")
            by_index = {
                value["candidateIndex"]: value for value in decisions
                if isinstance(value, dict) and isinstance(value.get("candidateIndex"), int)
            }
            if set(by_index) != set(range(len(candidates))):
                raise ValueError("boundary response must decide every candidate")
            refined = [
                self._apply_boundary_decision(item, by_index[index])
                for index, item in enumerate(candidates)
                if by_index[index].get("keep") is not False
            ]
            if refined:
                return refined
            return self._recheck_zero_concept_result(candidates, document)
        except (ModelCallError, ValueError, json.JSONDecodeError):
            return candidates

    def _recheck_zero_concept_result(
        self,
        candidates: list[ExtractedItem],
        document: PaperDocument | None,
    ) -> list[ExtractedItem]:
        assert self._client is not None
        payload = [
            self._adjudication_payload(index, item, document)
            for index, item in enumerate(candidates)
        ]
        prompt = (
            concept.ZERO_RESULT_RECHECK_INSTRUCTION
            + "\n输出严格 JSON：{\"items\":[{\"candidateIndex\":0,\"keep\":true,"
            "\"sourceTerm\":\"...\",\"displayName\":\"...\",\"normalizedName\":\"...\"}]}。"
            + "\n必须为每个 candidateIndex 返回一次决定。\n【全篇候选】\n"
            + json.dumps(payload, ensure_ascii=False)
        )
        try:
            parsed = json.loads(self._client.generate("Return valid JSON only.", prompt))
            decisions = parsed.get("items") if isinstance(parsed, dict) else None
            if not isinstance(decisions, list):
                raise ValueError("zero-result recheck requires items")
            by_index = {
                value["candidateIndex"]: value for value in decisions
                if isinstance(value, dict) and isinstance(value.get("candidateIndex"), int)
            }
            if set(by_index) != set(range(len(candidates))):
                raise ValueError("zero-result recheck must decide every candidate")
            kept = [
                self._apply_boundary_decision(item, by_index[index])
                for index, item in enumerate(candidates)
                if by_index[index].get("keep") is not False
            ]
            return kept[:3]
        except (ModelCallError, ValueError, json.JSONDecodeError):
            return []

    @staticmethod
    def _adjudication_payload(
        index: int,
        item: ExtractedItem,
        document: PaperDocument | None,
    ) -> dict[str, object]:
        term = (item.source_term or item.display or item.normalized or "").strip()
        occurrences = 0
        sections: list[str] = []
        if document and term:
            folded = term.casefold()
            for chunk in document.chunks:
                if folded in chunk.chunk_text.casefold():
                    occurrences += chunk.chunk_text.casefold().count(folded)
                    if chunk.section not in sections:
                        sections.append(chunk.section)
        return {
            "candidateIndex": index,
            "sourceTerm": item.source_term,
            "displayName": item.display,
            "normalizedName": item.normalized,
            "occurrences": occurrences,
            "sections": sections,
            "evidence": [{"section": value.section, "text": value.text} for value in item.evidence],
        }

    @staticmethod
    def _entity_key(item: ExtractedItem) -> str:
        label = item.source_term or item.normalized or item.display or ""
        key = re.sub(r"[\W_]+", "", label.casefold(), flags=re.UNICODE)
        if key.endswith("s") and len(key) > 4:
            key = key[:-1]
        return key

    @staticmethod
    def _normalized_entity_key(item: ExtractedItem) -> str:
        label = item.normalized or item.display or item.source_term or ""
        key = re.sub(r"[\W_]+", "", label.casefold(), flags=re.UNICODE)
        if key.endswith("s") and len(key) > 4:
            key = key[:-1]
        return key

    @staticmethod
    def _is_featured(term: str, document: PaperDocument) -> bool:
        folded = term.casefold()
        sources = [document.title or "", document.abstract or "", *document.keywords]
        return any(folded in source.casefold() for source in sources)

    @staticmethod
    def _term_document_stats(term: str, document: PaperDocument) -> tuple[int, int]:
        folded = term.casefold()
        occurrences = 0
        sections: set[str] = set()
        for chunk in document.chunks:
            if "reference" in chunk.section.casefold():
                continue
            count = chunk.chunk_text.casefold().count(folded)
            if count:
                occurrences += count
                sections.add(chunk.section.casefold())
        return occurrences, len(sections)

    @classmethod
    def _filter_concept_candidates(
        cls,
        items: list[ExtractedItem],
        document: PaperDocument,
    ) -> list[ExtractedItem]:
        retained: list[ExtractedItem] = []
        for item in items:
            term = (item.source_term or item.display or item.normalized or "").strip()
            if not term:
                continue
            key = re.sub(r"[\W_]+", "", term.casefold(), flags=re.UNICODE)
            if key in _GENERIC_ENTITY_KEYS or re.fullmatch(r"(?:axiom|figure|table|task)\d+", key):
                continue
            occurrences, section_count = cls._term_document_stats(term, document)
            explicit = any(_STRONG_CONCEPT_CUE.search(value.text) for value in item.evidence)
            if cls._is_featured(term, document) or explicit or (occurrences >= 2 and section_count >= 2):
                retained.append(item)
        return retained

    @classmethod
    def _filter_method_candidates(
        cls,
        items: list[ExtractedItem],
        document: PaperDocument,
    ) -> list[ExtractedItem]:
        retained: list[ExtractedItem] = []
        for item in items:
            term = (item.source_term or item.display or item.normalized or "").strip()
            if not term:
                continue
            key = re.sub(r"[\W_]+", "", term.casefold(), flags=re.UNICODE)
            if key in _GENERIC_ENTITY_KEYS:
                continue
            occurrences, section_count = cls._term_document_stats(term, document)
            method_section = any(
                _is_method_section_name(value.section)
                for value in item.evidence
            )
            explicit_use = any(_METHOD_USE_CUE.search(value.text) for value in item.evidence)
            if cls._is_featured(term, document) or explicit_use or method_section or (occurrences >= 2 and section_count >= 2):
                retained.append(item)
        return retained

    @classmethod
    def _select_core_entities(
        cls,
        items: list[ExtractedItem],
        document: PaperDocument,
        limit: int,
    ) -> list[ExtractedItem]:
        """Rank globally adjudicated entities, then keep the paper's core set.

        Full-text retrieval, batched extraction, boundary review and global
        deduplication all happen before this final cap.  The cap therefore
        never means "first six chunks" or "first six model outputs".
        """
        if len(items) <= limit:
            return items

        def score(indexed: tuple[int, ExtractedItem]) -> tuple[int, int, int, float, int, int]:
            index, item = indexed
            term = (item.source_term or item.display or item.normalized or "").strip()
            occurrences, section_count = cls._term_document_stats(term, document)
            return (
                int(cls._is_featured(term, document)),
                section_count,
                occurrences,
                item.confidence or 0,
                len({value.id for value in item.evidence}),
                -index,
            )

        ranked = sorted(enumerate(items), key=score, reverse=True)
        return [item for _, item in ranked[:limit]]

    @staticmethod
    def _deduplicate_concepts(
        items: list[ExtractedItem],
        prefer_normalized: bool = False,
    ) -> list[ExtractedItem]:
        grouped: dict[str, list[ExtractedItem]] = {}
        order: list[str] = []
        for item in items:
            key = (
                SinglePaperExtractor._normalized_entity_key(item)
                if prefer_normalized else SinglePaperExtractor._entity_key(item)
            )
            if not key:
                continue
            if key not in grouped:
                grouped[key] = []
                order.append(key)
            grouped[key].append(item)
        merged: list[ExtractedItem] = []
        for key in order:
            values = grouped[key]
            representative = max(values, key=lambda value: (value.confidence or 0, len(value.source_term or "")))
            evidence = []
            seen_evidence: set[str] = set()
            for value in values:
                for entry in value.evidence:
                    if entry.id not in seen_evidence:
                        seen_evidence.add(entry.id)
                        evidence.append(entry)
            merged.append(ExtractedItem(
                source_term=max((value.source_term for value in values if value.source_term), key=len, default=representative.source_term),
                text=representative.text,
                display=representative.display,
                normalized=representative.normalized,
                method_type=None,
                reason=representative.reason,
                confidence=max((value.confidence for value in values if value.confidence is not None), default=None),
                evidence_ids=[entry.id for entry in evidence],
                evidence=evidence,
            ))
        return merged

    def _extract_methods(self, agent: _AgentDefinition, document: PaperDocument) -> list[ExtractedItem]:
        terms = self._method_navigation_terms(document)
        self._report(65, "定位方法证据")
        method_chunks = self._method_retrieval_chunks(document, terms, prefer_method_sections=True)
        extracted = self._extract_method_batches(agent, document, method_chunks) if method_chunks else []

        # Only fall back after the complete Methods/Materials route has produced
        # no valid method. Abstract/Keywords provide navigation terms, while all
        # non-reference chunks remain reachable in batches (no fixed document cap).
        if not extracted:
            fallback_chunks = self._method_retrieval_chunks(document, terms, prefer_method_sections=False)
            extracted = self._extract_method_batches(agent, document, fallback_chunks)

        deduplicated = self._deduplicate_methods(extracted)
        self._report(70, "统一复核研究方法")
        refined = self._refine_method_boundaries(deduplicated, document)
        final = self._deduplicate_methods(refined, prefer_normalized=True)
        return self._select_core_entities(final, document, MAX_METHODS_PER_PAPER)

    def _extract_method_batches(
        self, agent: _AgentDefinition, document: PaperDocument, chunks: list[PaperChunk],
    ) -> list[ExtractedItem]:
        results: list[ExtractedItem] = []
        errors: list[Exception] = []
        total_batches = max(1, (len(chunks) + METHOD_BATCH_CHUNKS - 1) // METHOD_BATCH_CHUNKS)
        for batch_index, start in enumerate(range(0, len(chunks), METHOD_BATCH_CHUNKS), start=1):
            batch = chunks[start:start + METHOD_BATCH_CHUNKS]
            if not batch:
                continue
            try:
                raw = self._mock_response(agent, batch) if self._mode == "mock" else self._live_response(agent, document, batch)
                results.extend(self._validate_items(agent, raw, document, batch))
            except (ModelCallError, ValueError, json.JSONDecodeError) as error:
                errors.append(error)
            self._report(65 + round(4 * batch_index / total_batches), f"提取研究方法 {batch_index}/{total_batches}")
        if not results and errors and len(errors) * METHOD_BATCH_CHUNKS >= len(chunks):
            raise ValueError(f"all method extraction batches failed: {errors[-1]}")
        return results

    def _method_retrieval_chunks(
        self,
        document: PaperDocument,
        terms: list[str],
        prefer_method_sections: bool,
    ) -> list[PaperChunk]:
        chunks = [chunk for chunk in document.chunks if "reference" not in chunk.section.casefold()]

        # The first pass really is Methods-first when the paper exposes such a
        # section.  Abstract/full-text retrieval is reserved for the explicit
        # fallback pass, so a strong abstract sentence cannot silently bypass
        # an available Methods section.
        if prefer_method_sections:
            method_chunks = [
                chunk for chunk in chunks
                if _is_method_section_name(chunk.section)
            ]
            if method_chunks:
                chunks = method_chunks

        def score(chunk: PaperChunk) -> tuple[int, int]:
            text = chunk.chunk_text.casefold()
            term_hits = sum(1 for term in terms if term.casefold() in text)
            section = chunk.section.casefold()
            in_method = _is_method_section_name(section)
            # A Methods heading is a routing signal, not sufficient by itself:
            # long sections often contain controls, parameters and incidental
            # prose.  A navigation-term hit or an explicit use verb promotes
            # the chunk to model context.
            value = term_hits * 2 + (3 if in_method else 0)
            if _METHOD_USE_CUE.search(chunk.chunk_text):
                value += 5
            if "abstract" in section:
                value += 1
            if any(token in section for token in _METHOD_LOW_SIGNAL_SECTION_TOKENS):
                value -= 4
            return value, -document.chunks.index(chunk)

        ranked = sorted(chunks, key=score, reverse=True)
        selected = [chunk for chunk in ranked if score(chunk)[0] >= 5]
        if selected:
            return selected
        abstract = [chunk for chunk in ranked if "abstract" in chunk.section.casefold()]
        if abstract:
            return abstract
        best = score(ranked[0])[0] if ranked else 0
        return [chunk for chunk in ranked if score(chunk)[0] == best]

    def _method_navigation_terms(self, document: PaperDocument) -> list[str]:
        deterministic = list(dict.fromkeys(keyword.strip() for keyword in document.keywords if keyword.strip()))
        if self._mode == "mock" or self._client is None:
            return deterministic
        section_titles = list(dict.fromkeys(chunk.section for chunk in document.chunks))
        prompt = (
            method.NAVIGATION_INSTRUCTION
            + "\n\n输出严格 JSON：{\"terms\":[\"English search term\"]}。"
            + "\n【标题】\n" + (document.title or "")
            + "\n【Abstract】\n" + (document.abstract or "")
            + "\n【原文 Keywords】\n" + json.dumps(document.keywords, ensure_ascii=False)
            + "\n【章节标题】\n" + json.dumps(section_titles, ensure_ascii=False)
        )
        try:
            parsed = json.loads(self._client.generate("Return valid JSON only.", prompt))
            values = parsed.get("terms") if isinstance(parsed, dict) else None
            if isinstance(values, list):
                model_terms = [value.strip() for value in values if isinstance(value, str) and value.strip()]
                return list(dict.fromkeys([*deterministic, *model_terms]))
        except (ModelCallError, ValueError, json.JSONDecodeError):
            pass
        return deterministic

    def _refine_method_boundaries(
        self,
        items: list[ExtractedItem],
        document: PaperDocument | None = None,
    ) -> list[ExtractedItem]:
        if self._mode == "mock" or self._client is None or not items:
            return items
        candidates = self._filter_method_candidates(items, document) if document else items
        if not candidates:
            return []
        payload = [
            {**self._adjudication_payload(index, item, document), "methodType": item.method_type}
            for index, item in enumerate(candidates)
        ]
        prompt = (
            method.BOUNDARY_INSTRUCTION
            + "\n这是全篇候选的统一准入裁决；相同方法及其任务变体应合并到合适粒度。"
            + "\n输出严格 JSON：{\"items\":[{\"candidateIndex\":0,\"keep\":true,"
            "\"sourceTerm\":\"...\",\"displayName\":\"...\",\"normalizedName\":\"...\"}]}。"
            + "\n必须为每个 candidateIndex 返回一次决定。\n【全篇候选】\n"
            + json.dumps(payload, ensure_ascii=False)
        )
        try:
            parsed = json.loads(self._client.generate("Return valid JSON only.", prompt))
            decisions = parsed.get("items") if isinstance(parsed, dict) else None
            if not isinstance(decisions, list):
                raise ValueError("boundary response requires items")
            by_index = {
                value["candidateIndex"]: value for value in decisions
                if isinstance(value, dict) and isinstance(value.get("candidateIndex"), int)
            }
            if set(by_index) != set(range(len(candidates))):
                raise ValueError("boundary response must decide every candidate")
            return [
                self._apply_boundary_decision(item, by_index[index])
                for index, item in enumerate(candidates)
                if by_index[index].get("keep") is not False
            ]
        except (ModelCallError, ValueError, json.JSONDecodeError):
            return candidates

    @staticmethod
    def _apply_boundary_decision(item: ExtractedItem, decision: dict[str, object] | None) -> ExtractedItem:
        if not decision:
            return item
        evidence_text = "\n".join(value.text for value in item.evidence).casefold()
        source = decision.get("sourceTerm")
        if not isinstance(source, str) or not source.strip() or source.strip().casefold() not in evidence_text:
            source = item.source_term
        display = decision.get("displayName")
        normalized = decision.get("normalizedName")
        return ExtractedItem(
            source_term=source.strip() if isinstance(source, str) else item.source_term,
            text=item.text,
            display=display.strip() if isinstance(display, str) and display.strip() else item.display,
            normalized=normalized.strip() if isinstance(normalized, str) and normalized.strip() else item.normalized,
            method_type=item.method_type,
            reason=item.reason,
            confidence=item.confidence,
            evidence_ids=item.evidence_ids,
            evidence=item.evidence,
        )

    @staticmethod
    def _deduplicate_methods(
        items: list[ExtractedItem],
        prefer_normalized: bool = False,
    ) -> list[ExtractedItem]:
        grouped: dict[str, list[ExtractedItem]] = {}
        order: list[str] = []
        for item in items:
            key = (
                SinglePaperExtractor._normalized_entity_key(item)
                if prefer_normalized else SinglePaperExtractor._entity_key(item)
            )
            if not key:
                continue
            if key not in grouped:
                grouped[key] = []
                order.append(key)
            grouped[key].append(item)
        merged: list[ExtractedItem] = []
        for key in order:
            values = grouped[key]
            representative = max(values, key=lambda value: (value.confidence or 0, len(value.source_term or "")))
            evidence = []
            seen_evidence: set[str] = set()
            for value in values:
                for entry in value.evidence:
                    if entry.id not in seen_evidence:
                        seen_evidence.add(entry.id)
                        evidence.append(entry)
            merged.append(ExtractedItem(
                source_term=max((value.source_term for value in values if value.source_term), key=len, default=representative.source_term),
                text=representative.text,
                display=representative.display,
                normalized=representative.normalized,
                method_type=representative.method_type,
                reason=representative.reason,
                confidence=max((value.confidence for value in values if value.confidence is not None), default=None),
                evidence_ids=[entry.id for entry in evidence],
                evidence=evidence,
            ))
        return merged

    def _live_response(self, agent: _AgentDefinition, document: PaperDocument, chunks: list[PaperChunk]) -> dict[str, object]:
        assert self._client is not None
        prompt = self._render_live_prompt(agent, document, chunks)
        initial = self._client.generate("Return only valid JSON.", prompt)
        try:
            return self._parse_json_response(initial)
        except (ValueError, json.JSONDecodeError):
            repair_prompt = (
                "Repair the following model output into valid JSON that exactly matches the required schema. "
                "Do not add fields or invent evidence. Return JSON only.\n\n"
                f"Required task:\n{prompt}\n\nInvalid output:\n{initial}"
            )
            repaired = self._client.generate("Return only valid JSON.", repair_prompt)
            return self._parse_json_response(repaired)

    @staticmethod
    def _parse_json_response(value: str) -> dict[str, object]:
        parsed = json.loads(value)
        if not isinstance(parsed, dict) or set(parsed) != {"items"} or not isinstance(parsed["items"], list):
            raise ValueError("model output must be an object containing only an items array")
        return parsed

    @staticmethod
    def _render_live_prompt(agent: _AgentDefinition, document: PaperDocument, chunks: list[PaperChunk]) -> str:
        title = document.metadata.get("title", "")
        source_chunks = [{"chunkId": chunk.chunk_id, "section": chunk.section, "text": chunk.chunk_text} for chunk in chunks]
        return (
            GLOBAL_GUARDRAILS.format(max_items=agent.max_items)
            + f"\n\nTASK_NAME={agent.name}\n【当前任务】\n{agent.instruction}"
            + "\n\n【严格输出 JSON 模板】\n{\n  \"items\": ["
            + json.dumps(agent.output_template, ensure_ascii=False)
            + "]\n}\n除 items 及模板字段外不得输出任何字段。evidenceRefs 必须引用下方给出的 chunkId。"
            + f"\n\n【论文标题】\n{title}\n【允许引用的原文块】\n"
            + json.dumps(source_chunks, ensure_ascii=False)
        )

    @staticmethod
    def _mock_response(agent: _AgentDefinition, chunks: list[PaperChunk]) -> dict[str, object]:
        chunk = chunks[0]
        ref = [{"chunkId": chunk.chunk_id, "text": chunk.chunk_text}]
        shared = {"reason": "离线 mock：该项目的证据已通过原文校验。", "confidence": 0.8, "evidenceRefs": ref}
        if agent.name == "research_questions":
            item = {"text": "该研究探讨的核心问题", "sourceTerm": chunk.chunk_text, **shared}
        elif agent.name == "concepts":
            item = {"sourceTerm": "source concept", "displayName": "源概念", "normalizedName": "源概念", "description": None, **shared}
        elif agent.name == "methods":
            item = {"sourceTerm": "source method", "displayName": "源方法", "normalizedName": "源方法", "methodType": "other", "description": None, **shared}
        else:
            item = {"text": "原文支持的发现", "sourceTerm": chunk.chunk_text, **shared}
        return {"items": [item]}

    @staticmethod
    def _validate_items(agent: _AgentDefinition, raw: dict[str, object], document: PaperDocument, chunks: list[PaperChunk]) -> list[ExtractedItem]:
        chunk_map = {chunk.chunk_id: (index, chunk) for index, chunk in enumerate(chunks)}
        results: list[ExtractedItem] = []
        for raw_item in raw["items"][: agent.max_items]:
            if not isinstance(raw_item, dict):
                continue
            item = SinglePaperExtractor._validate_item_shape(agent.name, raw_item)
            evidence = SinglePaperExtractor._resolve_evidence(item["evidenceRefs"], document.paper_id, chunk_map)
            if evidence is None:
                continue
            results.append(ExtractedItem(
                source_term=item.get("sourceTerm"), text=item.get("text"), display=item.get("displayName"),
                normalized=item.get("normalizedName"), method_type=item.get("methodType"), reason=item["reason"],
                confidence=item["confidence"], evidence_ids=[entry.id for entry in evidence], evidence=evidence,
            ))
        return results

    @staticmethod
    def _validate_item_shape(agent_name: str, item: dict[str, object]) -> dict[str, Any]:
        # Models occasionally omit descriptive fields or return ``statement``
        # (the documented finding field) instead of the old internal ``text``.
        # Normalize harmless variations rather than discarding evidence-backed
        # content wholesale; semantic fields and evidence remain mandatory.
        normalized: dict[str, Any] = dict(item)
        if agent_name == "findings":
            normalized["text"] = normalized.get("text", normalized.get("statement"))
            normalized["sourceTerm"] = normalized.get("sourceTerm", normalized.get("text"))
        if agent_name in {"concepts", "methods"}:
            normalized.setdefault("description", None)
        normalized.setdefault("reason", "原文证据直接支持该项。")
        normalized.setdefault("confidence", None)
        for key in ("sourceTerm", "text", "displayName", "normalizedName", "description"):
            if key in normalized and normalized[key] is not None and not isinstance(normalized[key], str):
                raise ValueError(f"{agent_name}.{key} must be a string or null")
        if not isinstance(normalized["reason"], str) or not normalized["reason"].strip():
            normalized["reason"] = "原文证据直接支持该项。"
        non_empty_by_agent = {
            "research_questions": ("text",),
            # The public extraction schema explicitly allows sourceTerm=null
            # when the model cannot isolate a safe verbatim English label.  A
            # translated displayName plus exact evidence is still usable and
            # must not invalidate every otherwise valid item in the batch.
            "concepts": ("displayName",),
            "methods": ("displayName",),
            "findings": ("text",),
        }
        for key in non_empty_by_agent[agent_name]:
            if not isinstance(normalized.get(key), str) or not normalized[key].strip():
                raise ValueError(f"{agent_name}.{key} must be a non-empty string")
        confidence = normalized["confidence"]
        if confidence is not None and (not isinstance(confidence, (int, float)) or isinstance(confidence, bool) or not 0 <= confidence <= 1):
            raise ValueError(f"{agent_name}.confidence must be null or between 0 and 1")
        if not isinstance(normalized.get("evidenceRefs"), list) or not normalized["evidenceRefs"]:
            raise ValueError(f"{agent_name}.evidenceRefs must be a non-empty array")
        if agent_name == "methods" and normalized.get("methodType") not in ALLOWED_METHOD_TYPES:
            raise ValueError("methods.methodType is not allowed")
        return normalized

    @staticmethod
    def _resolve_evidence(refs: list[object], paper_id: str, chunk_map: dict[str, tuple[int, PaperChunk]]) -> list[Evidence] | None:
        evidence: list[Evidence] = []
        for ref in refs:
            if not isinstance(ref, dict) or set(ref) != {"chunkId", "text"}:
                return None
            chunk_id, text = ref.get("chunkId"), ref.get("text")
            if not isinstance(chunk_id, str) or not isinstance(text, str) or chunk_id not in chunk_map:
                return None
            index, chunk = chunk_map[chunk_id]
            try:
                evidence.append(chunk.as_document_chunk(paper_id, index).evidence_for(text))
            except ValueError:
                return None
        return evidence
