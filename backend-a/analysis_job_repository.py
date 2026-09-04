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
    return {
        "id": row["id"],
        "paperId": row["paper_id"],
        "status": row["status"],
        "progress": row["progress"],
        "stage": row["stage"],
        "error": error,
        "createdAt": _utc(row["created_at"]),
        "startedAt": _utc(row["started_at"]),
        "completedAt": _utc(row["completed_at"]),
    }


def create_job(database_path: Path, paper_id: str) -> dict:
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
                    id, paper_id, status, progress, stage, previous_paper_status
                ) VALUES (?, ?, 'queued', 0, 'queued', ?)
                """,
                (job_id, paper_id, paper["status"]),
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


def get_job(database_path: Path, job_id: str) -> dict:
    connection = connect(database_path)
    connection.row_factory = sqlite3.Row
    row = connection.execute("SELECT * FROM analysis_jobs WHERE id = ?", (job_id,)).fetchone()
    connection.close()
    if not row:
        raise JobNotFoundError
    return serialize_job(row)


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
