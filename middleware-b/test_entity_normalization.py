import importlib
import unittest


entity_normalization = importlib.import_module("middleware-b.entity_normalization")

EntityNormalizer = entity_normalization.EntityNormalizer
MatchCandidate = entity_normalization.MatchCandidate
RawEntity = entity_normalization.RawEntity


class CandidateClient:
    def __init__(self):
        self.calls = []

    def query(self, entity_type, raw_text, normalized_label, context, limit):
        self.calls.append((entity_type, normalized_label))
        if normalized_label == "精确概念":
            return [MatchCandidate("exact", "精确概念", 0.99, [])]
        if normalized_label == "候选甲":
            return [MatchCandidate("a", "现有甲", 0.8, [])]
        return [MatchCandidate("b", "现有乙", 0.7, [])]


class BatchModel:
    def __init__(self):
        self.calls = 0

    def generate(self, _system, _prompt):
        self.calls += 1
        return """{"items":[
          {"candidateIndex":0,"status":"matched","matchedEntityIds":["a"],"candidateEntityIds":[],"proposedCanonicalName":null,"existingRecommendationScores":[],"newRecommendationScore":null,"reason":"语义一致。"},
          {"candidateIndex":1,"status":"new","matchedEntityIds":[],"candidateEntityIds":[],"proposedCanonicalName":"候选乙","existingRecommendationScores":[],"newRecommendationScore":0.9,"reason":"现有节点不是同一方法。"}
        ]}"""


class EntityNormalizationBatchTest(unittest.TestCase):
    def test_many_entities_share_one_model_call_and_exact_match_is_local(self):
        candidate_client = CandidateClient()
        model = BatchModel()
        normalizer = EntityNormalizer(candidate_client, "live", model)
        entities = [
            RawEntity("raw a", "候选甲", "concept", "context", []),
            RawEntity("raw b", "候选乙", "method", "context", []),
            RawEntity("exact", "精确概念", "concept", "context", []),
        ]

        decisions = normalizer.normalize_many(entities)

        self.assertEqual(1, model.calls)
        self.assertEqual(["matched", "new", "matched"], [decision.status for decision in decisions])
        self.assertEqual(["exact"], decisions[2].matched_entity_ids)
        self.assertEqual(3, len(candidate_client.calls))


if __name__ == "__main__":
    unittest.main()
