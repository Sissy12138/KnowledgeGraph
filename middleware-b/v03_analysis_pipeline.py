"""The v0.5 orchestration boundary: extract, normalize, then submit."""

from __future__ import annotations

from dataclasses import dataclass

from .paper_extraction import PaperDocument, SinglePaperExtractor, StructuredPaperExtraction
from .submission import SubmissionRecord, SubmissionService
from .v03_result_builder import V03ResultBuilder
from .research_overview import ResearchOverviewBuilder, ResearchOverviewResult


class AnalysisPipelineError(RuntimeError):
    pass


@dataclass(frozen=True)
class V03PipelineResult:
    extraction: StructuredPaperExtraction
    research_overview: ResearchOverviewResult | dict[str, object]
    submission: SubmissionRecord


class V03AnalysisPipeline:
    """Does not make matching or submission decisions outside their owning components."""

    def __init__(self, extractor: SinglePaperExtractor, result_builder: V03ResultBuilder, submission_service: SubmissionService,
                 overview_builder: ResearchOverviewBuilder | None = None) -> None:
        self._extractor = extractor
        self._result_builder = result_builder
        self._submission_service = submission_service
        self._overview_builder = overview_builder or ResearchOverviewBuilder()

    def run(self, task_id: str, document: PaperDocument, research_overview: dict[str, object] | None = None) -> V03PipelineResult:
        extraction = self._extractor.extract(document)
        if extraction.agent_errors:
            raise AnalysisPipelineError(f"extraction failed: {extraction.agent_errors}")
        overview = research_overview if research_overview is not None else self._overview_builder.build(document, extraction)
        result = self._result_builder.build(extraction, overview)
        record = self._submission_service.prepare(task_id, document.paper_id, result)
        submitted = self._submission_service.submit(record.submission_id)
        return V03PipelineResult(extraction, overview, submitted)
