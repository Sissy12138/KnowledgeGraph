import io
import json
import tempfile
import unittest
from pathlib import Path

from .api import create_app
from .analysis_job_repository import create_job
from .analysis_service import submit_analysis_result
from .database import connect
from .graph_service import get_graph
from .review_service import accept_suggestion, list_suggestions


class V05FlowTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "test.sqlite3"
        connection = connect(self.database_path)
        with connection:
            connection.execute(
                """
                INSERT INTO papers (
                    id, source_type, source_library_id, source_item_key, item_type, title, status
                ) VALUES ('paper-1', 'manual', 0, 'paper-1', 'journalArticle', '测试论文', 'unprocessed')
                """
            )
            connection.execute(
                """
                INSERT INTO graph_nodes (
                    id, node_type, label, aliases, source_paper_ids
                ) VALUES ('concept-existing', 'concept', '反转学习', '[]', '[]')
                """
            )
        connection.close()

    def tearDown(self):
        self.temp_dir.cleanup()

    def _request(self, method: str, path: str, body: dict | None = None, query: str = ""):
        raw = json.dumps(body, ensure_ascii=False).encode("utf-8") if body is not None else b""
        environ = {
            "REQUEST_METHOD": method,
            "PATH_INFO": path,
            "QUERY_STRING": query,
            "CONTENT_LENGTH": str(len(raw)),
            "wsgi.input": io.BytesIO(raw),
        }
        captured = {}

        def start_response(status, headers):
            captured["status"] = status

        response = b"".join(create_app(self.database_path)(environ, start_response))
        return captured["status"], json.loads(response.decode("utf-8")) if response else None

    @staticmethod
    def _payload(submission_id: str, suffix: str = "1") -> dict:
        return {
            "submissionId": submission_id,
            "paperId": "paper-1",
            "researchOverview": {
                "researchTopics": ["反转学习"],
                "researchQuestion": "反转学习是否影响策略切换？",
                "sample": "20名参与者",
                "methods": "行为任务",
                "mainResults": "策略切换表现改善",
            },
            "evidence": [
                {"clientRef": f"ev-{suffix}", "section": "Results", "text": "反转学习促进策略切换。"}
            ],
            "concepts": [
                {
                    "clientRef": f"concept-{suffix}",
                    "rawText": "反转学习与策略切换",
                    "normalizedLabel": "反转学习与策略切换",
                    "matchStatus": "uncertain",
                    "candidates": [
                        {
                            "clientRef": f"existing-{suffix}",
                            "kind": "existing",
                            "nodeId": "concept-existing",
                            "label": "反转学习",
                            "recommendationScore": 0.9,
                        },
                        {
                            "clientRef": f"new-{suffix}",
                            "kind": "new",
                            "nodeId": None,
                            "label": f"策略切换-{suffix}",
                            "recommendationScore": 0.8,
                        },
                    ],
                    "extractionConfidence": 0.95,
                    "evidenceRefs": [f"ev-{suffix}"],
                }
            ],
            "methods": [],
            "findings": [],
            "relationCandidates": [
                {
                    "source": {"type": "resolutionCandidateRef", "value": f"existing-{suffix}"},
                    "target": {"type": "resolutionCandidateRef", "value": f"new-{suffix}"},
                    "relationType": "relatedTo",
                    "confidence": 0.7,
                    "evidenceRefs": [f"ev-{suffix}"],
                }
            ],
        }

    def test_submit_review_graph_and_supersede(self):
        job = create_job(self.database_path, "paper-1")
        payload = self._payload("submission-1")
        accepted, created = submit_analysis_result(self.database_path, job["id"], payload)
        self.assertTrue(created)

        retried, created = submit_analysis_result(self.database_path, job["id"], payload)
        self.assertFalse(created)
        self.assertEqual(accepted["extractionId"], retried["extractionId"])

        page = list_suggestions(self.database_path, 1, 20, "paper-1", "pending", None)
        resolve = next(item for item in page["items"] if item["operation"] == "resolveConceptMatch")
        candidate_ids = resolve["proposedChange"]["candidateIds"]
        result = accept_suggestion(
            self.database_path,
            resolve["id"],
            {
                "comment": None,
                "resolution": {
                    "selectedTargets": [
                        {"candidateId": candidate_ids[0], "labelOverride": None},
                        {"candidateId": candidate_ids[1], "labelOverride": None},
                    ]
                },
            },
        )
        self.assertEqual(2, len(result["executionResult"]["resolvedTargets"]))

        page = list_suggestions(self.database_path, 1, 20, "paper-1", "pending", None)
        relation = next(item for item in page["items"] if item["operation"] == "addRelation")
        accept_suggestion(
            self.database_path,
            relation["id"],
            {"comment": None, "resolution": None},
        )
        graph = get_graph(self.database_path, "paper-1", 2, 30)
        self.assertGreaterEqual(graph["meta"]["nodeCount"], 3)

        second_job = create_job(self.database_path, "paper-1")
        submit_analysis_result(
            self.database_path,
            second_job["id"],
            self._payload("submission-2", "2"),
        )
        third_job = create_job(self.database_path, "paper-1")
        submit_analysis_result(
            self.database_path,
            third_job["id"],
            self._payload("submission-3", "3"),
        )
        statuses = list_suggestions(self.database_path, 1, 100, "paper-1", None, None)["statusCounts"]
        self.assertGreaterEqual(statuses["superseded"], 1)

    def test_http_routes_follow_v05(self):
        status, job = self._request("POST", "/api/v1/papers/paper-1/analysis-jobs")
        self.assertEqual("201 Created", status)
        status, result = self._request(
            "POST",
            f"/api/v1/internal/analysis-jobs/{job['id']}/result",
            self._payload("submission-http"),
        )
        self.assertEqual("201 Created", status)
        self.assertEqual(1, len(result["suggestionIds"]))

        status, page = self._request("GET", "/api/v1/suggestions", query="status=pending")
        self.assertEqual("200 OK", status)
        suggestion = page["items"][0]
        status, accepted = self._request(
            "POST",
            f"/api/v1/suggestions/{suggestion['id']}/accept",
            {
                "comment": None,
                "resolution": {
                    "selectedTargets": [
                        {
                            "candidateId": suggestion["proposedChange"]["defaultCandidateId"],
                            "labelOverride": None,
                        }
                    ]
                },
            },
        )
        self.assertEqual("200 OK", status)
        self.assertEqual("accepted", accepted["status"])

        status, graph = self._request(
            "GET", "/api/v1/graph", query="focusNodeId=paper-1&depth=2&maxNodes=30"
        )
        self.assertEqual("200 OK", status)
        self.assertGreaterEqual(graph["meta"]["nodeCount"], 2)


if __name__ == "__main__":
    unittest.main()
