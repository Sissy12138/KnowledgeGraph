import sqlite3
import uuid
from pathlib import Path

from .database import connect


class PaperNotFoundError(Exception):
    pass


class JobNotFoundError(Exception):
    pass


class ActiveJobError(Exception):
    def __init__(self, job_id: str):
        super().__init__(job_id)
        self.job_id = job_id


class JobNotCancellableError(Exception):
    pass


class JobNotDeletableError(Exception):
    pass


def _utc(value: str | None) -> str | None:
    if value and "T" not in value:
        return value.replace(" ", "T", 1) + "Z"
    return value


def serialize_job(row: sqlite3.Row) -> dict:
    error = None
    if row["error_code"]:
        error = {
            "code": row["error_code"],
            "message": row["error_message"] or "任务失败",
            "retryable": False,
            "details": None,
            "requestId": "local",
        }
    result = {
        "id": row["id"],
        "paperId": row["paper_id"],
        "status": row["status"],
        "progress": row["progress"],
        "stage": row["stage"],
        "resultMode": row["result_mode"] if "result_mode" in row.keys() else "preserve",
        "error": error,
        "createdAt": _utc(row["created_at"]),
        "startedAt": _utc(row["started_at"]),
        "completedAt": _utc(row["completed_at"]),
    }
    if "paper_title" in row.keys():
        result["paperTitle"] = row["paper_title"]
        result["paperJournal"] = row["paper_journal"]
        result["paperYear"] = row["paper_year"]
    return result


def create_job(database_path: Path, paper_id: str, result_mode: str = "preserve") -> dict:
    if result_mode not in {"preserve", "replace"}:
        raise ValueError("resultMode 必须是 preserve 或 replace")
    connection = connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            paper = connection.execute("SELECT status FROM papers WHERE id = ?", (paper_id,)).fetchone()
            if not paper:
                raise PaperNotFoundError

            active = connection.execute(
                """
                SELECT id FROM analysis_jobs
                WHERE paper_id = ? AND status IN ('queued', 'processing')
                """,
                (paper_id,),
            ).fetchone()
            if active:
                raise ActiveJobError(active["id"])

            job_id = str(uuid.uuid4())
            connection.execute(
                """
                INSERT INTO analysis_jobs (
                    id, paper_id, status, progress, stage, result_mode, previous_paper_status
                ) VALUES (?, ?, 'queued', 0, 'queued', ?, ?)
                """,
                (job_id, paper_id, result_mode, paper["status"]),
            )
            connection.execute(
                """
                UPDATE papers
                SET status = 'queued', latest_job_id = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (job_id, paper_id),
            )
            row = connection.execute("SELECT * FROM analysis_jobs WHERE id = ?", (job_id,)).fetchone()
        return serialize_job(row)
    finally:
        connection.close()


def create_jobs_for_new_papers(database_path: Path) -> dict:
    """Queue every newly imported, still-unprocessed paper in one transaction."""
    connection = connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            papers = connection.execute(
                "SELECT id, status FROM papers WHERE status = 'unprocessed' ORDER BY created_at, id"
            ).fetchall()
            jobs = []
            for paper in papers:
                job_id = str(uuid.uuid4())
                connection.execute(
                    """
                    INSERT INTO analysis_jobs (
                        id, paper_id, status, progress, stage, previous_paper_status
                    ) VALUES (?, ?, 'queued', 0, 'queued', ?)
                    """,
                    (job_id, paper["id"], paper["status"]),
                )
                connection.execute(
                    """
                    UPDATE papers
                    SET status = 'queued', latest_job_id = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (job_id, paper["id"]),
                )
                jobs.append(serialize_job(
                    connection.execute("SELECT * FROM analysis_jobs WHERE id = ?", (job_id,)).fetchone()
                ))
        return {"createdCount": len(jobs), "jobs": jobs}
    finally:
        connection.close()


def get_job(database_path: Path, job_id: str) -> dict:
    connection = connect(database_path)
    connection.row_factory = sqlite3.Row
    row = connection.execute("SELECT * FROM analysis_jobs WHERE id = ?", (job_id,)).fetchone()
    connection.close()
    if not row:
        raise JobNotFoundError
    return serialize_job(row)


def list_jobs(database_path: Path, status: str | None = None, limit: int = 20) -> dict:
    if limit < 1 or limit > 100:
        raise ValueError("limit 必须在 1–100 之间")
    allowed = {"queued", "processing", "completed", "failed", "cancelled"}
    if status is not None and status not in allowed:
        raise ValueError("status 不合法")
    connection = connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        if status:
            rows = connection.execute(
                """
                SELECT analysis_jobs.*, papers.title AS paper_title,
                       papers.journal_name AS paper_journal, papers.year AS paper_year
                FROM analysis_jobs
                JOIN papers ON papers.id = analysis_jobs.paper_id
                WHERE analysis_jobs.status = ?
                ORDER BY analysis_jobs.created_at, analysis_jobs.id
                LIMIT ?
                """,
                (status, limit),
            ).fetchall()
        else:
            rows = connection.execute(
                """
                SELECT analysis_jobs.*, papers.title AS paper_title,
                       papers.journal_name AS paper_journal, papers.year AS paper_year
                FROM analysis_jobs
                JOIN papers ON papers.id = analysis_jobs.paper_id
                ORDER BY analysis_jobs.created_at, analysis_jobs.id
                LIMIT ?
                """,
                (limit,),
            ).fetchall()
        return {"items": [serialize_job(row) for row in rows], "status": status, "limit": limit}
    finally:
        connection.close()


def cancel_job(database_path: Path, job_id: str) -> dict:
    connection = connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            row = connection.execute("SELECT * FROM analysis_jobs WHERE id = ?", (job_id,)).fetchone()
            if not row:
                raise JobNotFoundError
            if row["status"] == "cancelled":
                return serialize_job(row)
            if row["status"] not in {"queued", "processing"}:
                raise JobNotCancellableError

            connection.execute(
                """
                UPDATE analysis_jobs
                SET status = 'cancelled', stage = 'cancelled', completed_at = CURRENT_TIMESTAMP
                WHERE id = ?
                """,
                (job_id,),
            )
            connection.execute(
                """
                UPDATE papers
                SET status = ?, updated_at = CURRENT_TIMESTAMP
                WHERE id = ? AND latest_job_id = ?
                """,
                (row["previous_paper_status"], row["paper_id"], job_id),
            )
            updated = connection.execute("SELECT * FROM analysis_jobs WHERE id = ?", (job_id,)).fetchone()
        return serialize_job(updated)
    finally:
        connection.close()


def delete_job(database_path: Path, job_id: str) -> dict:
    """Delete a failed/cancelled run only when the paper has a completed run."""
    connection = connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            row = connection.execute(
                "SELECT * FROM analysis_jobs WHERE id = ?",
                (job_id,),
            ).fetchone()
            if not row:
                raise JobNotFoundError
            if row["status"] not in {"failed", "cancelled"}:
                raise JobNotDeletableError

            completed = connection.execute(
                """
                SELECT id FROM analysis_jobs
                WHERE paper_id = ? AND status = 'completed'
                ORDER BY completed_at DESC, created_at DESC, id DESC
                LIMIT 1
                """,
                (row["paper_id"],),
            ).fetchone()
            if not completed:
                raise JobNotDeletableError

            paper = connection.execute(
                "SELECT latest_job_id FROM papers WHERE id = ?",
                (row["paper_id"],),
            ).fetchone()
            if paper and paper["latest_job_id"] == job_id:
                connection.execute(
                    """
                    UPDATE papers
                    SET latest_job_id = ?, status = ?, updated_at = CURRENT_TIMESTAMP
                    WHERE id = ?
                    """,
                    (completed["id"], row["previous_paper_status"], row["paper_id"]),
                )
            connection.execute("DELETE FROM analysis_jobs WHERE id = ?", (job_id,))
        return {"deletedJobId": job_id, "paperId": row["paper_id"]}
    finally:
        connection.close()


def update_job_progress(database_path: Path, job_id: str, progress: int, stage: str) -> dict:
    """Claim a queued job or publish a monotonic worker progress update."""
    if not isinstance(progress, int) or progress < 0 or progress > 99:
        raise ValueError("progress 必须是 0–99 的整数")
    if not isinstance(stage, str) or not stage.strip():
        raise ValueError("stage 不能为空")
    connection = connect(database_path)
    connection.row_factory = sqlite3.Row
    try:
        with connection:
            row = connection.execute("SELECT * FROM analysis_jobs WHERE id = ?", (job_id,)).fetchone()
            if not row:
                raise JobNotFoundError
            if row["status"] not in {"queued", "processing"}:
                return serialize_job(row)
            next_progress = max(row["progress"], progress)
            connection.execute(
                "UPDATE analysis_jobs SET status='processing', progress=?, stage=?, started_at=COALESCE(started_at, CURRENT_TIMESTAMP) WHERE id=?",
                (next_progress, stage.strip()[:80], job_id),
            )
            connection.execute(
                "UPDATE papers SET status='processing', updated_at=CURRENT_TIMESTAMP WHERE id=? AND latest_job_id=?",
                (row["paper_id"], job_id),
            )
            updated = connection.execute("SELECT * FROM analysis_jobs WHERE id = ?", (job_id,)).fetchone()
        return serialize_job(updated)
    finally:
        connection.close()


def fail_job(database_path: Path, job_id: str, code: str, message: str) -> dict:
    connection = connect(database_path); connection.row_factory = sqlite3.Row
    try:
        with connection:
            row = connection.execute("SELECT * FROM analysis_jobs WHERE id = ?", (job_id,)).fetchone()
            if not row: raise JobNotFoundError
            if row["status"] in {"completed", "cancelled"}: return serialize_job(row)
            connection.execute("UPDATE analysis_jobs SET status='failed', stage='failed', error_code=?, error_message=?, completed_at=CURRENT_TIMESTAMP WHERE id=?", (code, message[:500], job_id))
            connection.execute("UPDATE papers SET status='failed', updated_at=CURRENT_TIMESTAMP WHERE id=? AND latest_job_id=?", (row["paper_id"], job_id))
            row = connection.execute("SELECT * FROM analysis_jobs WHERE id = ?", (job_id,)).fetchone()
        return serialize_job(row)
    finally: connection.close()
