import json
import unittest
from importlib import import_module

paper_extraction = import_module("middleware-b.paper_extraction")
research_overview = import_module("middleware-b.research_overview")
PaperChunk = paper_extraction.PaperChunk
PaperDocument = paper_extraction.PaperDocument
StructuredPaperExtraction = paper_extraction.StructuredPaperExtraction
LiveResearchOverviewExtractor = research_overview.LiveResearchOverviewExtractor


class FakeClient:
    def generate(self, _system_prompt: str, _user_prompt: str) -> str:
        return json.dumps({
            "researchQuestion": {"value": "睡眠质量是否影响记忆表现？", "evidenceRefs": [{"chunkId": "abstract", "text": "We tested whether sleep quality predicts memory performance."}]},
            "sample": {"value": "120 名成年参与者", "evidenceRefs": [{"chunkId": "methods", "text": "A total of 120 adult participants completed the study."}]},
            "methods": [{"value": "记忆测验与线性回归分析", "evidenceRefs": [{"chunkId": "methods", "text": "Participants completed a memory task and linear regression analysis."}]}],
            "mainResults": [{"value": "较高睡眠质量预测更好的记忆表现。", "evidenceRefs": [{"chunkId": "results", "text": "Higher sleep quality predicted better memory performance."}]}],
        })


class LiveResearchOverviewExtractorTest(unittest.TestCase):
    def test_extracts_all_overview_fields_with_exact_evidence(self):
        document = PaperDocument(
            "paper-1", {"title": "Sleep and memory"}, [
                PaperChunk("Abstract", "abstract", "We tested whether sleep quality predicts memory performance."),
                PaperChunk("Methods", "methods", "A total of 120 adult participants completed the study. Participants completed a memory task and linear regression analysis."),
                PaperChunk("Results", "results", "Higher sleep quality predicted better memory performance."),
            ],
        )
        extraction = StructuredPaperExtraction("paper-1", [], [], [], [], {})
        result = LiveResearchOverviewExtractor(FakeClient()).extract(document, extraction)

        self.assertEqual(result.research_question, "睡眠质量是否影响记忆表现？")
        self.assertEqual(result.sample, "120 名成年参与者")
        self.assertEqual(result.methods, "记忆测验与线性回归分析")
        self.assertEqual(result.main_results, "较高睡眠质量预测更好的记忆表现。")
        self.assertEqual(result.evidence_by_field["sample"][0].text, "A total of 120 adult participants completed the study.")
        self.assertEqual(
            result.to_payload()["original"]["sample"],
            "A total of 120 adult participants completed the study.",
        )

    def test_searches_full_text_but_only_sends_overview_evidence(self):
        class CountingClient:
            def __init__(self):
                self.calls = 0
                self.prompts = []

            def generate(self, _system_prompt: str, user_prompt: str) -> str:
                self.calls += 1
                self.prompts.append(user_prompt)
                return json.dumps({
                    "researchQuestion": None,
                    "sample": None,
                    "methods": [],
                    "mainResults": [],
                })

        client = CountingClient()
        chunks = [PaperChunk("Abstract", "abstract", "This paper tests adaptive behavior.")]
        chunks.extend(
            PaperChunk("Appendix", f"noise-{index}", f"administrative text {index}")
            for index in range(18)
        )
        chunks.append(PaperChunk("Results", "late-result", "We found that performance improved."))
        chunks.append(PaperChunk("References", "references", "should not be sent"))
        document = PaperDocument("paper-batches", {"title": "Batch coverage"}, chunks)
        extraction = StructuredPaperExtraction("paper-batches", [], [], [], [], {})

        LiveResearchOverviewExtractor(client).extract(document, extraction)

        self.assertEqual(client.calls, 1)
        self.assertIn("late-result", client.prompts[0])
        self.assertNotIn("noise-17", client.prompts[0])
        self.assertNotIn("references", client.prompts[0])
