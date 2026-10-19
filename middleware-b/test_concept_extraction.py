import importlib
import json
from types import SimpleNamespace
import unittest
from unittest.mock import patch


paper_extraction = importlib.import_module("middleware-b.paper_extraction")
models = importlib.import_module("middleware-b.models")

PaperChunk = paper_extraction.PaperChunk
PaperDocument = paper_extraction.PaperDocument
SinglePaperExtractor = paper_extraction.SinglePaperExtractor
CONCEPT_AGENT = next(agent for agent in paper_extraction._AGENTS if agent.name == "concepts")
live_worker = importlib.import_module("middleware-b.scripts.run_live_worker")


def concept_item(chunk, name):
    return {
        "sourceTerm": name,
        "displayName": name,
        "normalizedName": name,
        "description": None,
        "reason": "该概念是本研究反复讨论的研究对象。",
        "confidence": 0.9,
        "evidenceRefs": [{"chunkId": chunk.chunk_id, "text": chunk.chunk_text}],
    }


class ConceptExtractionPipelineTest(unittest.TestCase):
    def test_full_text_is_searched_beyond_fourteen_chunks_without_sending_noise(self):
        chunks = [PaperChunk("Abstract", "abstract", "This paper studies adaptive behavior.")]
        chunks.extend(
            PaperChunk("Appendix", f"noise-{index}", "Administrative details and supplementary prose.")
            for index in range(18)
        )
        chunks.append(PaperChunk(
            "Discussion", "late-hit",
            "We define persistent internal state as a representation that organizes behavior.",
        ))
        document = PaperDocument("paper", {"title": "Long paper"}, chunks)
        seen_chunk_ids = []

        def response(_agent, batch):
            seen_chunk_ids.extend(chunk.chunk_id for chunk in batch)
            chunk = batch[0]
            return {"items": [concept_item(chunk, f"concept from {chunk.chunk_id}")]}

        extractor = SinglePaperExtractor("mock")
        with patch.object(SinglePaperExtractor, "_mock_response", side_effect=response):
            result = extractor._extract_concepts(CONCEPT_AGENT, document)

        self.assertEqual({"abstract", "late-hit"}, set(seen_chunk_ids))
        self.assertNotIn("noise-17", seen_chunk_ids)
        self.assertEqual(1, len(result))

    def test_full_text_candidates_are_globally_ranked_then_capped_at_six(self):
        chunks = [
            PaperChunk("Results", f"concept-{index}", f"The study discussed conceptual state {index}.")
            for index in range(12)
        ]
        document = PaperDocument("paper", {"title": "Many concepts"}, chunks)

        def response(_agent, batch):
            return {"items": [concept_item(batch[0], f"concept {batch[0].chunk_id}-{index}") for index in range(8)]}

        extractor = SinglePaperExtractor("mock")
        with patch.object(SinglePaperExtractor, "_mock_response", side_effect=response):
            result = extractor._extract_concepts(CONCEPT_AGENT, document)

        self.assertEqual(6, len(result))

    def test_abstract_and_original_keyword_hits_are_kept_while_unrelated_chunks_are_dropped(self):
        chunks = [
            PaperChunk("Abstract", "abstract", "This paper studies behavior."),
            PaperChunk("Other", "keyword-hit", "A persistent internal state organizes behavior."),
            PaperChunk("Introduction", "introduction", "Prior work motivates this study."),
        ]
        document = PaperDocument("paper", {"keywords": ["persistent internal state"]}, chunks)

        ranked = SinglePaperExtractor("mock")._concept_ranked_chunks(document)

        self.assertEqual("abstract", ranked[0].chunk_id)
        self.assertEqual({"abstract", "keyword-hit"}, {chunk.chunk_id for chunk in ranked})

    def test_global_prefilter_rejects_generic_and_numbered_labels(self):
        evidence = [
            models.Evidence("e1", "paper", "Results", "The group completed Axiom 1."),
            models.Evidence(
                "e2", "paper", "Abstract",
                "Persistent internal state organizes behavior across environments.",
            ),
        ]
        items = [
            paper_extraction.ExtractedItem("group", None, "群体", "群体", None, "", 0.8, ["e1"], [evidence[0]]),
            paper_extraction.ExtractedItem("Axiom 1", None, "公理1", "公理1", None, "", 0.8, ["e1"], [evidence[0]]),
            paper_extraction.ExtractedItem(
                "persistent internal state", None, "持续内在状态", "持续内在状态", None,
                "", 0.9, ["e2"], [evidence[1]],
            ),
        ]
        document = PaperDocument(
            "paper",
            {"abstract": evidence[1].text},
            [
                PaperChunk("Abstract", "a", evidence[1].text),
                PaperChunk("Results", "r", "The group completed Axiom 1."),
            ],
        )

        retained = SinglePaperExtractor._filter_concept_candidates(items, document)

        self.assertEqual(["persistent internal state"], [item.source_term for item in retained])

    def test_final_deduplication_merges_acronym_and_expanded_alias(self):
        evidence = models.Evidence("e1", "paper", "Abstract", "We introduce S3AP.")
        items = [
            paper_extraction.ExtractedItem(
                "S3AP", None, "S3AP", "S3AP", None, "", 0.9, ["e1"], [evidence],
            ),
            paper_extraction.ExtractedItem(
                "Structured Social Simulation Analysis Protocol", None, "S3AP", "S3AP", None,
                "", 0.8, ["e1"], [evidence],
            ),
        ]

        merged = SinglePaperExtractor._deduplicate_concepts(items, prefer_normalized=True)

        self.assertEqual(1, len(merged))
        self.assertEqual("S3AP", merged[0].normalized)

    def test_boundary_second_pass_completes_multiword_concept_and_drops_generic_term(self):
        class BoundaryClient:
            def generate(self, _system, _prompt):
                return """{"items":[
                    {"candidateIndex":0,"keep":true,"sourceTerm":"persistent internal state","displayName":"持续内在状态","normalizedName":"持续内在状态"},
                    {"candidateIndex":1,"keep":false,"sourceTerm":"analysis","displayName":"分析","normalizedName":"分析"}
                ]}"""

        first_evidence = models.Evidence(
            "evidence-1", "paper", "Abstract", "We studied a persistent internal state in the population."
        )
        second_evidence = models.Evidence("evidence-2", "paper", "Results", "We performed an analysis.")
        items = [
            paper_extraction.ExtractedItem(
                "internal state", None, "内在状态", "内在状态", None,
                "原文证据。", 0.8, [first_evidence.id], [first_evidence],
            ),
            paper_extraction.ExtractedItem(
                "analysis", None, "分析", "分析", None,
                "原文证据。", 0.7, [second_evidence.id], [second_evidence],
            ),
        ]

        refined = SinglePaperExtractor("live", BoundaryClient())._refine_concept_boundaries(items)

        self.assertEqual(1, len(refined))
        self.assertEqual("persistent internal state", refined[0].source_term)

    def test_all_rejected_candidates_receive_an_independent_zero_result_recheck(self):
        class RecheckClient:
            def __init__(self):
                self.calls = 0

            def generate(self, _system, _prompt):
                self.calls += 1
                keep = self.calls == 2
                return json.dumps({"items": [{
                    "candidateIndex": 0,
                    "keep": keep,
                    "sourceTerm": "others' beliefs",
                    "displayName": "他人信念",
                    "normalizedName": "他人信念",
                }]})

        evidence = models.Evidence(
            "evidence-belief", "paper", "Abstract",
            "We tested whether neurons encode others' beliefs.",
        )
        item = paper_extraction.ExtractedItem(
            "others' beliefs", None, "他人信念", "他人信念", None,
            "摘要明确将其作为研究对象。", 0.9, [evidence.id], [evidence],
        )
        document = PaperDocument(
            "paper",
            {"title": "Predictions of others' beliefs", "abstract": evidence.text},
            [PaperChunk("Abstract", "abstract", evidence.text)],
        )
        client = RecheckClient()

        refined = SinglePaperExtractor("live", client)._refine_concept_boundaries(
            [item], document,
        )

        self.assertEqual(2, client.calls)
        self.assertEqual(["他人信念"], [value.normalized for value in refined])

    def test_existing_concept_match_is_submitted_for_review_instead_of_forced_new(self):
        evidence = models.Evidence(
            "evidence", "paper", "Abstract", "A persistent internal state organized behavior."
        )
        item = paper_extraction.ExtractedItem(
            "persistent internal state", None, "持续内在状态", "持续内在状态", None,
            "本研究的核心概念。", 0.9, [evidence.id], [evidence],
        )
        candidate = SimpleNamespace(
            entity_id="concept-existing", canonical_name="持续内部状态", recommendation_score=0.97,
        )
        decision = SimpleNamespace(
            status="matched", candidates=[candidate], matched_entity_ids=["concept-existing"],
            selected_candidate_ids=[], recommendation_scores={}, canonical_name=None,
            new_recommendation_score=None,
        )
        extraction = SimpleNamespace(research_questions=[], concepts=[item], methods=[], findings=[])

        payload = live_worker.submission(
            extraction, "paper", concept_matches={"持续内在状态": decision},
        )

        concept = payload["concepts"][0]
        self.assertEqual("uncertain", concept["matchStatus"])
        self.assertEqual(["existing"], [value["kind"] for value in concept["candidates"]])


if __name__ == "__main__":
    unittest.main()
