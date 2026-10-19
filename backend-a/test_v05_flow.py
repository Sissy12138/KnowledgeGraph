import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from . import api
from .api import create_app
from .analysis_job_repository import create_job
from .analysis_service import AnalysisResultError, get_latest_extraction, submit_analysis_result
from .database import connect
from .graph_service import get_graph
from .review_service import (
    accept_suggestion,
    list_suggestions,
    reject_suggestion,
    replace_previous_analysis_results,
)


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
                "original": {
                    "researchTopics": ["reversal learning"],
                    "researchQuestion": "Does reversal learning affect strategy switching?",
                    "sample": "Twenty participants completed the study.",
                    "methods": "Participants completed a behavioral task.",
                    "mainResults": "Strategy-switching performance improved.",
                },
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
        extraction = get_latest_extraction(self.database_path, "paper-1")
        self.assertEqual(
            "Twenty participants completed the study.",
            extraction["researchOverview"]["original"]["sample"],
        )

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
        self.assertEqual("relatedTo", relation["proposedChange"]["relationType"])
        self.assertEqual(
            {"反转学习", "策略切换-1"},
            {
                relation["proposedChange"]["sourceLabel"],
                relation["proposedChange"]["targetLabel"],
            },
        )
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

    def test_replace_mode_removes_old_analysis_only_after_new_result_is_valid(self):
        first_job = create_job(self.database_path, "paper-1")
        first_result, _ = submit_analysis_result(
            self.database_path, first_job["id"], self._payload("replace-old", "old")
        )
        old_suggestions = list_suggestions(
            self.database_path, 1, 20, "paper-1", "pending", None
        )["items"]
        entity = next(
            item for item in old_suggestions if item["operation"] == "resolveConceptMatch"
        )
        accepted = accept_suggestion(
            self.database_path,
            entity["id"],
            {
                "comment": None,
                "resolution": {
                    "selectedTargets": [
                        {"candidateId": value, "labelOverride": None}
                        for value in entity["proposedChange"]["candidateIds"]
                    ]
                },
            },
        )
        old_created_node = next(
            target["nodeId"]
            for target in accepted["executionResult"]["resolvedTargets"]
            if target["created"]
        )

        replace_job = create_job(self.database_path, "paper-1", "replace")
        self.assertEqual("replace", replace_job["resultMode"])
        invalid = self._payload("replace-invalid", "invalid")
        invalid["paperId"] = "different-paper"
        with self.assertRaises(AnalysisResultError):
            submit_analysis_result(self.database_path, replace_job["id"], invalid)

        connection = connect(self.database_path)
        self.assertIsNotNone(connection.execute(
            "SELECT id FROM extractions WHERE id = ?", (first_result["extractionId"],)
        ).fetchone())
        self.assertIsNotNone(connection.execute(
            "SELECT id FROM graph_nodes WHERE id = ?", (old_created_node,)
        ).fetchone())
        connection.close()

        submit_analysis_result(
            self.database_path,
            replace_job["id"],
            self._payload("replace-new", "new"),
        )
        connection = connect(self.database_path)
        self.assertEqual(1, connection.execute(
            "SELECT COUNT(*) FROM extractions WHERE paper_id = 'paper-1'"
        ).fetchone()[0])
        self.assertIsNone(connection.execute(
            "SELECT id FROM extractions WHERE id = ?", (first_result["extractionId"],)
        ).fetchone())
        self.assertIsNone(connection.execute(
            "SELECT id FROM graph_nodes WHERE id = ?", (old_created_node,)
        ).fetchone())
        self.assertEqual(2, connection.execute(
            "SELECT COUNT(*) FROM analysis_jobs WHERE paper_id = 'paper-1'"
        ).fetchone()[0])
        connection.close()

    def test_posthoc_replace_reconciles_stale_graph_provenance(self):
        job = create_job(self.database_path, "paper-1")
        result, _ = submit_analysis_result(
            self.database_path, job["id"], self._payload("posthoc-current")
        )
        connection = connect(self.database_path)
        connection.row_factory = __import__("sqlite3").Row
        with connection:
            connection.execute(
                """
                INSERT INTO graph_nodes (id, node_type, label, aliases, source_paper_ids)
                VALUES ('stale-node', 'concept', '旧噪声概念', '[]', '["paper-1"]')
                """
            )
            connection.execute(
                """
                INSERT INTO graph_edges (
                    id, source_id, source_type, target_id, target_type,
                    relation_type, label, source_paper_ids
                ) VALUES (
                    'stale-edge', 'paper-1', 'paper', 'stale-node', 'concept',
                    'studies', 'studies', '["paper-1"]'
                )
                """
            )
            connection.execute(
                """
                INSERT INTO graph_edges (
                    id, source_id, source_type, target_id, target_type,
                    relation_type, label, source_paper_ids
                ) VALUES (
                    'current-citation', 'paper-1', 'paper', 'cited-paper', 'paper',
                    'cites', 'cites', '["paper-1"]'
                )
                """
            )
            replace_previous_analysis_results(
                connection, "paper-1", result["extractionId"]
            )

        self.assertIsNone(connection.execute(
            "SELECT id FROM graph_edges WHERE id = 'stale-edge'"
        ).fetchone())
        self.assertIsNone(connection.execute(
            "SELECT id FROM graph_nodes WHERE id = 'stale-node'"
        ).fetchone())
        self.assertIsNotNone(connection.execute(
            "SELECT id FROM graph_edges WHERE id = 'current-citation'"
        ).fetchone())
        connection.close()

    def test_batch_analysis_only_queues_new_unprocessed_papers(self):
        with patch.object(api, "public_status", return_value={"configured": True}):
            status, result = self._request("POST", "/api/v1/analysis-jobs/analyze-new", {})

            self.assertEqual(status, "201 Created")
            self.assertEqual(result["createdCount"], 1)
            self.assertEqual(result["jobs"][0]["paperId"], "paper-1")
            self.assertEqual(result["jobs"][0]["status"], "queued")

            status, result = self._request("POST", "/api/v1/analysis-jobs/analyze-new", {})
            self.assertEqual(status, "201 Created")
            self.assertEqual(result, {"createdCount": 0, "jobs": []})

    def test_rejecting_an_entity_automatically_rejects_its_relation(self):
        job = create_job(self.database_path, "paper-1")
        submit_analysis_result(self.database_path, job["id"], self._payload("cascade-reject"))
        page = list_suggestions(self.database_path, 1, 20, "paper-1", "pending", None)
        entity = next(item for item in page["items"] if item["operation"] == "resolveConceptMatch")
        accepted_entity = accept_suggestion(
            self.database_path,
            entity["id"],
            {
                "comment": None,
                "resolution": {
                    "selectedTargets": [
                        {"candidateId": value, "labelOverride": None}
                        for value in entity["proposedChange"]["candidateIds"]
                    ]
                },
            },
        )
        relation = next(
            item for item in list_suggestions(
                self.database_path, 1, 20, "paper-1", "pending", "addRelation"
            )["items"]
        )

        reject_suggestion(
            self.database_path,
            entity["id"],
            {"reason": "概念识别不准确"},
        )

        rejected = list_suggestions(
            self.database_path, 1, 20, "paper-1", "rejected", "addRelation"
        )["items"]
        linked = next(item for item in rejected if item["id"] == relation["id"])
        self.assertEqual("因关联概念或方法被拒绝，系统自动拒绝此关系。", linked["reviewComment"])
        created_node = next(
            target["nodeId"]
            for target in accepted_entity["executionResult"]["resolvedTargets"]
            if target["created"]
        )
        connection = connect(self.database_path)
        self.assertIsNone(connection.execute(
            "SELECT id FROM graph_nodes WHERE id = ?", (created_node,)
        ).fetchone())
        connection.close()

    def test_citations_are_written_directly_without_review_suggestions(self):
        connection = connect(self.database_path)
        with connection:
            connection.execute(
                """
                INSERT INTO papers (
                    id, source_type, source_library_id, source_item_key, item_type, title, status
                ) VALUES ('paper-2', 'manual', 0, 'paper-2', 'journalArticle', '被引用论文', 'completed')
                """
            )
        connection.close()
        payload = self._payload("citation-direct")
        payload["concepts"] = []
        payload["relationCandidates"] = [{
            "source": {"type": "formalNodeId", "value": "paper-1"},
            "target": {"type": "formalNodeId", "value": "paper-2"},
            "relationType": "cites",
            "confidence": 1.0,
            "evidenceRefs": ["ev-1"],
        }]
        job = create_job(self.database_path, "paper-1")

        result, created = submit_analysis_result(self.database_path, job["id"], payload)

        self.assertTrue(created)
        self.assertEqual([], result["suggestionIds"])
        connection = connect(self.database_path)
        edge = connection.execute(
            """
            SELECT relation_type FROM graph_edges
            WHERE source_id = 'paper-1' AND target_id = 'paper-2'
            """
        ).fetchone()
        self.assertEqual("cites", edge[0])
        connection.close()

    def test_analysis_rejects_more_than_six_concepts(self):
        payload = self._payload("too-many-concepts")
        payload["relationCandidates"] = []
        payload["concepts"] = []
        payload["evidence"] = []
        for index in range(7):
            evidence_ref = f"ev-limit-{index}"
            candidate_ref = f"candidate-limit-{index}"
            payload["evidence"].append({
                "clientRef": evidence_ref,
                "section": "Abstract",
                "text": f"Core concept {index} is discussed.",
            })
            payload["concepts"].append({
                "clientRef": f"concept-limit-{index}",
                "rawText": f"Core concept {index}",
                "normalizedLabel": f"核心概念 {index}",
                "matchStatus": "new",
                "candidates": [{
                    "clientRef": candidate_ref,
                    "kind": "new",
                    "nodeId": None,
                    "label": f"核心概念 {index}",
                    "recommendationScore": 0.8,
                }],
                "extractionConfidence": 0.8,
                "evidenceRefs": [evidence_ref],
            })
        job = create_job(self.database_path, "paper-1")

        with self.assertRaises(AnalysisResultError) as captured:
            submit_analysis_result(self.database_path, job["id"], payload)

        self.assertEqual("INVALID_ANALYSIS_RESULT", captured.exception.code)
        self.assertIn("最多提交 6 个概念", str(captured.exception))

    def test_accepted_suggestion_can_be_reopened_or_changed_to_rejected(self):
        job = create_job(self.database_path, "paper-1")
        submit_analysis_result(
            self.database_path,
            job["id"],
            self._payload("reconsider-accepted"),
        )
        page = list_suggestions(self.database_path, 1, 20, "paper-1", "pending", None)
        suggestion = next(
            item for item in page["items"] if item["operation"] == "resolveConceptMatch"
        )
        new_candidate_id = suggestion["proposedChange"]["candidateIds"][1]
        accept_body = {
            "comment": "首次采纳",
            "resolution": {
                "selectedTargets": [{"candidateId": new_candidate_id, "labelOverride": None}]
            },
        }

        status, accepted = self._request(
            "POST", f"/api/v1/suggestions/{suggestion['id']}/accept", accept_body
        )
        self.assertEqual("200 OK", status)
        created_node_id = accepted["executionResult"]["resolvedTargets"][0]["nodeId"]

        status, reopened = self._request(
            "POST", f"/api/v1/suggestions/{suggestion['id']}/reopen", {}
        )
        self.assertEqual("200 OK", status)
        self.assertEqual("pending", reopened["status"])
        self.assertIsNone(reopened["executionResult"])
        connection = connect(self.database_path)
        self.assertIsNone(connection.execute(
            "SELECT id FROM graph_nodes WHERE id = ?", (created_node_id,)
        ).fetchone())
        self.assertEqual(
            "uncertain",
            connection.execute(
                "SELECT match_status FROM extracted_concepts WHERE id = ?",
                (suggestion["proposedChange"]["extractedConceptId"],),
            ).fetchone()[0],
        )
        connection.close()

        status, accepted_again = self._request(
            "POST", f"/api/v1/suggestions/{suggestion['id']}/accept", accept_body
        )
        self.assertEqual("200 OK", status)
        second_node_id = accepted_again["executionResult"]["resolvedTargets"][0]["nodeId"]
        status, rejected = self._request(
            "POST",
            f"/api/v1/suggestions/{suggestion['id']}/reject",
            {"reason": "复核后改为拒绝"},
        )
        self.assertEqual("200 OK", status)
        self.assertEqual("rejected", rejected["status"])
        self.assertEqual("复核后改为拒绝", rejected["reviewComment"])
        self.assertIsNone(rejected["executionResult"])
        connection = connect(self.database_path)
        self.assertIsNone(connection.execute(
            "SELECT id FROM graph_nodes WHERE id = ?", (second_node_id,)
        ).fetchone())
        connection.close()

    def test_failed_job_can_be_deleted_after_a_completed_run(self):
        completed_job = create_job(self.database_path, "paper-1")
        submit_analysis_result(
            self.database_path,
            completed_job["id"],
            self._payload("completed-before-delete"),
        )
        failed_job = create_job(self.database_path, "paper-1")
        status, _ = self._request(
            "POST",
            f"/api/v1/internal/analysis-jobs/{failed_job['id']}/failed",
            {"code": "TEST_FAILURE", "message": "测试失败"},
        )
        self.assertEqual("200 OK", status)

        status, result = self._request(
            "DELETE", f"/api/v1/analysis-jobs/{failed_job['id']}"
        )

        self.assertEqual("200 OK", status)
        self.assertEqual(failed_job["id"], result["deletedJobId"])
        connection = connect(self.database_path)
        paper = connection.execute(
            "SELECT latest_job_id, status FROM papers WHERE id = 'paper-1'"
        ).fetchone()
        self.assertEqual(completed_job["id"], paper[0])
        self.assertEqual("pendingReview", paper[1])
        self.assertIsNone(connection.execute(
            "SELECT id FROM analysis_jobs WHERE id = ?", (failed_job["id"],)
        ).fetchone())
        connection.close()

        status, response = self._request(
            "DELETE", f"/api/v1/analysis-jobs/{completed_job['id']}"
        )
        self.assertEqual("409 Conflict", status)
        self.assertEqual("JOB_NOT_DELETABLE", response["error"]["code"])

    def test_failed_job_without_completed_run_cannot_be_deleted(self):
        failed_job = create_job(self.database_path, "paper-1")
        self._request(
            "POST",
            f"/api/v1/internal/analysis-jobs/{failed_job['id']}/failed",
            {"code": "TEST_FAILURE", "message": "测试失败"},
        )

        status, response = self._request(
            "DELETE", f"/api/v1/analysis-jobs/{failed_job['id']}"
        )

        self.assertEqual("409 Conflict", status)
        self.assertEqual("JOB_NOT_DELETABLE", response["error"]["code"])

    def test_submission_retains_cross_paper_evidence_provenance(self):
        connection = connect(self.database_path)
        with connection:
            connection.execute(
                """
                INSERT INTO papers (id, source_type, source_library_id, source_item_key, item_type, title, status)
                VALUES ('paper-2', 'manual', 0, 'paper-2', 'journalArticle', '对照论文', 'completed')
                """
            )
        connection.close()
        job = create_job(self.database_path, "paper-1")
        payload = self._payload("cross-evidence")
        payload["evidence"].append({
            "clientRef": "evidence-from-paper-2", "paperId": "paper-2", "section": "跨论文证据 · Methods",
            "text": "The comparison paper fit a drift diffusion model.",
        })
        accepted, _ = submit_analysis_result(self.database_path, job["id"], payload)
        extraction = get_latest_extraction(self.database_path, "paper-1")
        evidence = next(item for item in extraction["evidence"] if item["id"] in {
            value["id"] for value in extraction["evidence"] if value["paperId"] == "paper-2"
        })
        self.assertEqual(accepted["extractionId"], extraction["id"])
        self.assertEqual(evidence["paperId"], "paper-2")

    def test_http_routes_follow_v05(self):
        status, configured = self._request("POST", "/api/v1/model-config", {
            "provider": "deepseek",
            "baseUrl": "https://api.deepseek.com",
            "model": "deepseek-v4-flash",
            "apiKey": "test-only-key",
        })
        self.assertEqual("200 OK", status)
        self.assertTrue(configured["configured"])
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
