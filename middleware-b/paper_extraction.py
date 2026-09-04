"""Single-paper knowledge extraction using either offline or live agents."""

from __future__ import annotations

from dataclasses import dataclass, field
from hashlib import sha256
import json
from typing import Any, Literal

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
    def __init__(self, mode: ExtractionMode, client: ModelClient | None = None) -> None:
        if mode == "live" and client is None:
            raise ValueError("live mode requires a model client")
        self._mode = mode
        self._client = client

    def extract(self, document: PaperDocument) -> StructuredPaperExtraction:
        if not document.chunks:
            raise ValueError("PaperDocument must contain at least one chunk")
        grouped: dict[str, list[ExtractedItem]] = {agent.name: [] for agent in _AGENTS}
        errors: dict[str, str] = {}
        for agent in _AGENTS:
            chunks = self._select_chunks(document.chunks, agent.preferred_sections)
            try:
                raw = self._mock_response(agent, chunks) if self._mode == "mock" else self._live_response(agent, document, chunks)
                grouped[agent.name] = self._validate_items(agent, raw, document, chunks)
            except (ModelCallError, ValueError, json.JSONDecodeError) as error:
                errors[agent.name] = str(error)
        return StructuredPaperExtraction(document.paper_id, grouped["research_questions"], grouped["concepts"], grouped["methods"], grouped["findings"], errors)

    @staticmethod
    def _select_chunks(chunks: list[PaperChunk], preferred_sections: tuple[str, ...]) -> list[PaperChunk]:
        preferred = [chunk for chunk in chunks if any(token in chunk.section.lower() for token in preferred_sections)]
        return (preferred or chunks)[:8]

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
        required: dict[str, set[str]] = {
            "research_questions": {"text", "sourceTerm", "reason", "confidence", "evidenceRefs"},
            "concepts": {"sourceTerm", "displayName", "normalizedName", "description", "reason", "confidence", "evidenceRefs"},
            "methods": {"sourceTerm", "displayName", "normalizedName", "methodType", "description", "reason", "confidence", "evidenceRefs"},
            "findings": {"text", "sourceTerm", "reason", "confidence", "evidenceRefs"},
        }
        if set(item) != required[agent_name]:
            raise ValueError(f"{agent_name} returned unsupported or missing fields")
        for key in ("reason",):
            if not isinstance(item[key], str) or not item[key].strip():
                raise ValueError(f"{agent_name}.{key} must be a non-empty string")
        for key in ("sourceTerm", "text", "displayName", "normalizedName", "description"):
            if key in item and item[key] is not None and not isinstance(item[key], str):
                raise ValueError(f"{agent_name}.{key} must be a string or null")
        non_empty_by_agent = {
            "research_questions": ("text",),
            "concepts": ("sourceTerm", "displayName"),
            "methods": ("sourceTerm", "displayName"),
            "findings": ("text",),
        }
        for key in non_empty_by_agent[agent_name]:
            if not isinstance(item[key], str) or not item[key].strip():
                raise ValueError(f"{agent_name}.{key} must be a non-empty string")
        confidence = item["confidence"]
        if confidence is not None and (not isinstance(confidence, (int, float)) or isinstance(confidence, bool) or not 0 <= confidence <= 1):
            raise ValueError(f"{agent_name}.confidence must be null or between 0 and 1")
        if not isinstance(item["evidenceRefs"], list) or not item["evidenceRefs"]:
            raise ValueError(f"{agent_name}.evidenceRefs must be a non-empty array")
        if agent_name == "methods" and item["methodType"] not in ALLOWED_METHOD_TYPES:
            raise ValueError("methods.methodType is not allowed")
        return item  # type: ignore[return-value]

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
