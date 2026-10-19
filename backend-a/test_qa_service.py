import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from . import qa_service
from .database import connect
from .qa_service import QuestionAnswerError, answer_question, retrieve_sources


class _Response:
    def __enter__(self):
        return self

    def __exit__(self, *_):
        return False

    def read(self):
        return json.dumps({"choices": [{"message": {"content": "该研究使用行为任务。[1]"}}]}).encode()


class QuestionAnswerTest(unittest.TestCase):
    def setUp(self):
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "qa.sqlite3"
        connection = connect(self.database_path)
        with connection:
            connection.execute(
                """
                INSERT INTO papers (
                    id, source_type, source_library_id, source_item_key, item_type,
                    title, abstract, status
                ) VALUES ('paper-qa', 'manual', 0, 'paper-qa', 'journalArticle', ?, ?, 'completed')
                """,
                ("反转学习行为研究", "研究使用行为任务评估反转学习。"),
            )
            connection.execute(
                """
                INSERT INTO analysis_jobs (
                    id, paper_id, status, progress, stage, result_mode, previous_paper_status, completed_at
                ) VALUES ('job-qa', 'paper-qa', 'completed', 100, '完成', 'preserve', 'unprocessed', CURRENT_TIMESTAMP)
                """
            )
            connection.execute(
                """
                INSERT INTO extractions (
                    id, paper_id, analysis_job_id, submission_id, research_topics,
                    research_question, methods, main_results
                ) VALUES ('extraction-qa', 'paper-qa', 'job-qa', 'submission-qa', ?, ?, ?, ?)
                """,
                (json.dumps(["反转学习"]), "反转学习如何形成？", "行为任务", "学习表现得到改善"),
            )
            connection.execute(
                """
                INSERT INTO evidence (id, extraction_id, paper_id, client_ref, section, text)
                VALUES ('evidence-qa', 'extraction-qa', 'paper-qa', 'ev-1', 'Methods', '参与者完成反转学习行为任务。')
                """
            )
        connection.close()

    def tearDown(self):
        self.temp_dir.cleanup()

    def test_retrieves_local_overview_and_evidence(self):
        sources = retrieve_sources(self.database_path, "反转学习使用什么方法？")
        self.assertTrue(any(source["paperId"] == "paper-qa" for source in sources))
        self.assertTrue(any(source["type"] == "evidence" for source in sources))

    def test_calls_configured_model_with_sources(self):
        config = {
            "provider": "openai", "baseUrl": "https://api.openai.com/v1",
            "model": "gpt-5-mini", "apiKey": "test-key",
        }
        with patch.object(qa_service, "urlopen", return_value=_Response()):
            result = answer_question(self.database_path, config, "反转学习使用什么方法？")
        self.assertEqual("该研究使用行为任务。[1]", result["answer"])
        self.assertTrue(result["sources"])
        self.assertEqual("gpt-5-mini", result["model"])

    def test_broad_question_falls_back_to_analyzed_papers(self):
        sources = retrieve_sources(self.database_path, "这些论文主要讲了什么？")
        self.assertTrue(sources)
        self.assertEqual("paper-qa", sources[0]["paperId"])

    def test_rejects_empty_question(self):
        with self.assertRaises(QuestionAnswerError):
            answer_question(self.database_path, {}, " ")

    def test_accepts_reasoning_content_from_compatible_provider(self):
        body = {"choices": [{"message": {"content": "", "reasoning_content": "基于材料的回答。[1]"}}]}
        self.assertEqual(
            "基于材料的回答。[1]",
            qa_service.extract_generated_text("deepseek", body),
        )


if __name__ == "__main__":
    unittest.main()
