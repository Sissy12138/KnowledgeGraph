import importlib
import json
import unittest


relations = importlib.import_module("middleware-b.method_relation_candidates")


class FakeModel:
    def __init__(self, response):
        self.response = response
        self.calls = 0

    def generate(self, _system, _prompt):
        self.calls += 1
        return json.dumps(self.response)


def submission():
    return {
        "evidence": [
            {"clientRef": "left-evidence", "section": "Methods", "text": "We fitted the model to the recordings."},
            {"clientRef": "right-evidence", "section": "Methods", "text": "The recordings were used as input to the model."},
        ],
        "methods": [
            {
                "normalizedLabel": "模型拟合",
                "evidenceRefs": ["left-evidence"],
                "candidates": [{"clientRef": "left-candidate", "recommendationScore": 0.9}],
            },
            {
                "normalizedLabel": "神经记录",
                "evidenceRefs": ["right-evidence"],
                "candidates": [{"clientRef": "right-candidate", "recommendationScore": 0.8}],
            },
        ],
        "relationCandidates": [],
    }


class SamePaperMethodRelationTest(unittest.TestCase):
    def test_only_second_pass_confirmed_relation_is_added(self):
        payload = submission()
        model = FakeModel({"items": [{
            "pairKey": "left-candidate::right-candidate",
            "relationType": "combinedWith",
            "confidence": 0.88,
            "leftEvidenceRefs": ["left-evidence"],
            "rightEvidenceRefs": ["right-evidence"],
        }]})

        count = relations.add_same_paper_method_candidates(payload, model)

        self.assertEqual(1, count)
        self.assertEqual("combinedWith", payload["relationCandidates"][0]["relationType"])
        self.assertEqual(["left-evidence", "right-evidence"], payload["relationCandidates"][0]["evidenceRefs"])

    def test_plain_cooccurrence_does_not_create_combined_relation(self):
        payload = submission()
        count = relations.add_same_paper_method_candidates(payload, FakeModel({"items": []}))
        self.assertEqual(0, count)
        self.assertEqual([], payload["relationCandidates"])


if __name__ == "__main__":
    unittest.main()
