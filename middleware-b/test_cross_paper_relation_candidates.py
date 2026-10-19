import unittest

from .cross_paper_relation_candidates import add_cross_paper_method_candidates


class _Model:
    def generate(self, _system: str, _prompt: str) -> str:
        return '''{"items":[{"pairKey":"candidate-current::method-existing","relationType":"variantOf","confidence":0.86,"sourceEvidenceRefs":["source-evidence"],"targetEvidenceIds":["target-evidence"]}]}'''


class CrossPaperRelationCandidateTest(unittest.TestCase):
    def test_adds_deferred_candidate_with_evidence_from_both_papers(self):
        submission = {
            "paperId": "paper-current",
            "evidence": [{"clientRef": "source-evidence", "section": "Methods", "text": "We use an extended drift diffusion model."}],
            "methods": [{
                "normalizedLabel": "extended drift diffusion model", "methodType": "computationalModel",
                "evidenceRefs": ["source-evidence"],
                "candidates": [{"clientRef": "candidate-current", "kind": "new"}],
            }],
            "relationCandidates": [],
        }
        graph = {"nodes": [{
            "id": "method-existing", "nodeType": "method", "label": "drift diffusion model",
            "sourcePaperIds": ["paper-existing"],
        }]}
        extractions = {"paper-existing": {
            "methods": [{"matchedMethodIds": ["method-existing"], "methodType": "computationalModel", "evidenceIds": ["target-evidence"]}],
            "evidence": [{"id": "target-evidence", "paperId": "paper-existing", "section": "Methods", "text": "We fit a drift diffusion model."}],
        }}

        count = add_cross_paper_method_candidates(submission, graph, extractions, _Model())

        self.assertEqual(count, 1)
        relation = submission["relationCandidates"][0]
        self.assertEqual(relation["source"], {"type": "resolutionCandidateRef", "value": "candidate-current"})
        self.assertEqual(relation["target"], {"type": "formalNodeId", "value": "method-existing"})
        self.assertEqual(relation["relationType"], "variantOf")
        copied = next(item for item in submission["evidence"] if item["clientRef"].startswith("cross-paper-"))
        self.assertEqual(copied["paperId"], "paper-existing")
        self.assertIn(copied["clientRef"], relation["evidenceRefs"])

    def test_rejects_a_model_item_without_both_evidence_sides(self):
        class MissingEvidenceModel:
            def generate(self, _system: str, _prompt: str) -> str:
                return '{"items":[{"pairKey":"candidate-current::method-existing","relationType":"alternativeTo","confidence":0.8,"sourceEvidenceRefs":[],"targetEvidenceIds":["target-evidence"]}]}'

        submission = {
            "paperId": "paper-current", "evidence": [{"clientRef": "source-evidence", "section": "Methods", "text": "source"}],
            "methods": [{"normalizedLabel": "model", "methodType": "computationalModel", "evidenceRefs": ["source-evidence"], "candidates": [{"clientRef": "candidate-current", "kind": "new"}]}],
            "relationCandidates": [],
        }
        graph = {"nodes": [{"id": "method-existing", "nodeType": "method", "label": "model", "sourcePaperIds": ["paper-existing"]}]}
        extractions = {"paper-existing": {"methods": [{"matchedMethodIds": ["method-existing"], "methodType": "computationalModel", "evidenceIds": ["target-evidence"]}], "evidence": [{"id": "target-evidence", "paperId": "paper-existing", "section": "Methods", "text": "target"}]}}

        self.assertEqual(add_cross_paper_method_candidates(submission, graph, extractions, MissingEvidenceModel()), 0)
        self.assertEqual(submission["relationCandidates"], [])
