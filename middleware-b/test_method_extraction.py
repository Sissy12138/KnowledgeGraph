import importlib
from types import SimpleNamespace
import unittest
from unittest.mock import patch


paper_extraction = importlib.import_module("middleware-b.paper_extraction")
pdf_ingestion = importlib.import_module("middleware-b.pdf_ingestion")

PaperChunk = paper_extraction.PaperChunk
PaperDocument = paper_extraction.PaperDocument
SinglePaperExtractor = paper_extraction.SinglePaperExtractor
METHOD_AGENT = next(agent for agent in paper_extraction._AGENTS if agent.name == "methods")
live_worker = importlib.import_module("middleware-b.scripts.run_live_worker")
models = importlib.import_module("middleware-b.models")


def method_item(chunk, name):
    return {
        "sourceTerm": name,
        "displayName": name,
        "normalizedName": name,
        "methodType": "other",
        "description": None,
        "reason": "原文明确说明本研究使用该方法。",
        "confidence": 0.9,
        "evidenceRefs": [{"chunkId": chunk.chunk_id, "text": chunk.chunk_text}],
    }


class MethodExtractionPipelineTest(unittest.TestCase):
    def test_all_high_signal_method_chunks_are_processed_without_fourteen_chunk_cap(self):
        chunks = [
            PaperChunk("Methods", f"method-{index}", f"We used method {index}.")
            for index in range(20)
        ]
        document = PaperDocument("paper", {"title": "Long methods"}, chunks)
        seen_chunk_ids = []

        def response(_agent, batch):
            seen_chunk_ids.extend(chunk.chunk_id for chunk in batch)
            chunk = batch[0]
            return {"items": [method_item(chunk, f"method from {chunk.chunk_id}")]}

        extractor = SinglePaperExtractor("mock")
        with patch.object(SinglePaperExtractor, "_mock_response", side_effect=response):
            result = extractor._extract_methods(METHOD_AGENT, document)

        self.assertEqual([chunk.chunk_id for chunk in chunks], seen_chunk_ids)
        self.assertEqual(3, len(result))

    def test_full_text_methods_are_globally_ranked_then_capped_at_six(self):
        chunks = [
            PaperChunk("Methods", f"method-{index}", f"We used a documented procedure in block {index}.")
            for index in range(12)
        ]
        document = PaperDocument("paper", {"title": "Many methods"}, chunks)

        def response(_agent, batch):
            return {
                "items": [
                    method_item(batch[0], f"method {batch[0].chunk_id}-{index}")
                    for index in range(8)
                ]
            }

        extractor = SinglePaperExtractor("mock")
        with patch.object(SinglePaperExtractor, "_mock_response", side_effect=response):
            result = extractor._extract_methods(METHOD_AGENT, document)

        self.assertEqual(6, len(result))

    def test_empty_methods_result_falls_back_to_full_text_retrieval(self):
        chunks = [
            PaperChunk("Methods", "methods", "No named procedure appears here."),
            PaperChunk("Abstract", "abstract", "We used a latent dynamical system model."),
            PaperChunk("Results", "results", "The model recovered the latent state."),
        ]
        document = PaperDocument(
            "paper",
            {"title": "Fallback", "abstract": chunks[1].chunk_text, "keywords": ["latent dynamics"]},
            chunks,
        )
        calls = 0

        def response(_agent, batch):
            nonlocal calls
            calls += 1
            if calls == 1:
                return {"items": []}
            abstract = next(chunk for chunk in batch if chunk.chunk_id == "abstract")
            return {"items": [method_item(abstract, "latent dynamical system model")]}

        extractor = SinglePaperExtractor("mock")
        with patch.object(SinglePaperExtractor, "_mock_response", side_effect=response):
            result = extractor._extract_methods(METHOD_AGENT, document)

        self.assertEqual(2, calls)
        self.assertEqual(["latent dynamical system model"], [item.normalized for item in result])

    def test_pdf_keywords_are_read_from_original_front_matter(self):
        text = "Abstract\nA study.\nKeywords: calcium imaging; neural dynamics, regression\n1 Introduction"
        self.assertEqual(
            ["calcium imaging", "neural dynamics", "regression"],
            pdf_ingestion.PdfPaperParser._keywords(text),
        )

    def test_null_source_term_does_not_discard_evidence_backed_method(self):
        chunk = PaperChunk("Methods", "method", "We used a structured simulation protocol.")
        document = PaperDocument("paper", {"title": "Method"}, [chunk])
        raw = {
            "items": [{
                "sourceTerm": None,
                "displayName": "结构化模拟协议",
                "normalizedName": "结构化模拟协议",
                "methodType": "computationalModel",
                "description": None,
                "reason": "原文明确实施该协议。",
                "confidence": 0.9,
                "evidenceRefs": [{"chunkId": "method", "text": chunk.chunk_text}],
            }],
        }

        items = SinglePaperExtractor("mock")._validate_items(METHOD_AGENT, raw, document, [chunk])

        self.assertEqual(1, len(items))
        self.assertIsNone(items[0].source_term)
        self.assertEqual("结构化模拟协议", items[0].display)

    def test_submission_includes_existing_method_matches_and_new_fallback(self):
        evidence = models.Evidence("evidence", "paper", "Methods", "We used latent dynamics.")
        item = paper_extraction.ExtractedItem(
            source_term="latent dynamics",
            text=None,
            display="潜在动力学",
            normalized="潜在动力学",
            method_type="computationalModel",
            reason="本研究实际使用。",
            confidence=0.9,
            evidence_ids=["evidence"],
            evidence=[evidence],
        )
        extraction = SimpleNamespace(
            research_questions=[], concepts=[], methods=[item], findings=[],
        )

        payload = live_worker.submission(
            extraction,
            "paper",
            method_matches={"潜在动力学": [{
                "nodeId": "method-existing",
                "label": "潜在动力学模型",
                "recommendationScore": 0.95,
            }]},
        )

        method = payload["methods"][0]
        self.assertEqual("uncertain", method["matchStatus"])
        self.assertEqual(["existing", "new"], [candidate["kind"] for candidate in method["candidates"]])
        self.assertEqual("method-existing", method["candidates"][0]["nodeId"])

    def test_boundary_second_pass_can_complete_a_method_name_and_drop_invalid_candidate(self):
        class BoundaryClient:
            def generate(self, _system, _prompt):
                return """{"items":[
                    {"candidateIndex":0,"keep":true,"sourceTerm":"switching linear dynamical system","displayName":"切换线性动力系统","normalizedName":"切换线性动力系统"},
                    {"candidateIndex":1,"keep":false,"sourceTerm":"analysis","displayName":"分析","normalizedName":"分析"}
                ]}"""

        first_evidence = models.Evidence(
            "evidence-1", "paper", "Methods", "We used a switching linear dynamical system for inference."
        )
        second_evidence = models.Evidence("evidence-2", "paper", "Methods", "We analyzed the data.")
        items = [
            paper_extraction.ExtractedItem(
                "linear dynamical system", None, "线性动力系统", "线性动力系统", "computationalModel",
                "原文证据。", 0.8, [first_evidence.id], [first_evidence],
            ),
            paper_extraction.ExtractedItem(
                "analysis", None, "分析", "分析", "other",
                "原文证据。", 0.7, [second_evidence.id], [second_evidence],
            ),
        ]

        refined = SinglePaperExtractor("live", BoundaryClient())._refine_method_boundaries(items)

        self.assertEqual(1, len(refined))
        self.assertEqual("switching linear dynamical system", refined[0].source_term)

    def test_llm_matched_method_is_submitted_as_existing_review_candidate(self):
        evidence = models.Evidence("evidence", "paper", "Methods", "We used latent dynamics.")
        item = paper_extraction.ExtractedItem(
            "latent dynamics", None, "潜在动力学", "潜在动力学", "computationalModel",
            "本研究实际使用。", 0.9, ["evidence"], [evidence],
        )
        candidate = SimpleNamespace(
            entity_id="method-existing", canonical_name="潜在动力学模型", recommendation_score=0.98,
        )
        decision = SimpleNamespace(
            status="matched", candidates=[candidate], matched_entity_ids=["method-existing"],
            selected_candidate_ids=[], recommendation_scores={}, canonical_name=None,
            new_recommendation_score=None,
        )
        extraction = SimpleNamespace(research_questions=[], concepts=[], methods=[item], findings=[])

        payload = live_worker.submission(
            extraction, "paper", method_matches={"潜在动力学": decision},
        )

        method = payload["methods"][0]
        self.assertEqual("uncertain", method["matchStatus"])
        self.assertEqual(["existing"], [value["kind"] for value in method["candidates"]])


if __name__ == "__main__":
    unittest.main()
