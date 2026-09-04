import json
import sqlite3
from pathlib import Path

from .database import connect


SORT_COLUMNS = {
    "createdAt": "p.created_at",
    "updatedAt": "p.updated_at",
    "year": "p.year",
    "title": "p.title",
}

PAPER_STATUSES = {
    "unprocessed",
    "queued",
    "processing",
    "pendingReview",
    "completed",
    "failed",
}


def _utc(value: str | None) -> str | None:
    if value and "T" not in value:
        return value.replace(" ", "T", 1) + "Z"
    return value


def _authors(connection: sqlite3.Connection, paper_id: str) -> list[dict]:
    rows = connection.execute(
        """
        SELECT a.id, a.name, pa.position
        FROM paper_authors pa
        JOIN authors a ON a.id = pa.author_id
        WHERE pa.paper_id = ?
        ORDER BY pa.position, a.id
        """,
        (paper_id,),
    ).fetchall()
    return [
        {
            "authorId": row["id"],
            "displayName": row["name"],
            "rawName": row["name"],
            "authorOrder": row["position"] + 1,
        }
        for row in rows
    ]


def _journal(row: sqlite3.Row) -> dict | None:
    if not row["journal_name"]:
        return None
    return {
        "name": row["journal_name"],
        "issn": row["issn"],
        "metrics": None,
    }


def _summary(connection: sqlite3.Connection, row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "authors": _authors(connection, row["id"]),
        "year": row["year"],
        "doi": row["doi"],
        "journal": _journal(row),
        "status": row["status"],
        "latestJobId": row["latest_job_id"],
        "pendingSuggestionCount": row["pending_suggestion_count"],
        "createdAt": _utc(row["created_at"]),
        "updatedAt": _utc(row["updated_at"]),
    }


def list_papers(
    database_path: Path,
    page: int,
    page_size: int,
    status: str | None,
    search: str | None,
    sort_by: str,
    sort_order: str,
) -> dict:
    if page < 1 or page_size < 1 or page_size > 100:
        raise ValueError("page 必须大于等于 1，pageSize 必须在 1–100 之间")
    if sort_by not in SORT_COLUMNS or sort_order not in {"asc", "desc"}:
        raise ValueError("sortBy 或 sortOrder 不合法")
    if status is not None and status not in PAPER_STATUSES:
        raise ValueError("status 不合法")

    connection = connect(database_path)
    connection.row_factory = sqlite3.Row
    conditions = []
    parameters: list[object] = []
    if status:
        conditions.append("p.status = ?")
        parameters.append(status)
    if search:
        conditions.append("(p.title LIKE ? OR p.doi LIKE ?)")
        pattern = f"%{search}%"
        parameters.extend([pattern, pattern])
    where = f"WHERE {' AND '.join(conditions)}" if conditions else ""

    total = connection.execute(
        f"SELECT COUNT(*) FROM papers p {where}",
        parameters,
    ).fetchone()[0]
    offset = (page - 1) * page_size
    rows = connection.execute(
        f"""
        SELECT p.*
        FROM papers p
        {where}
        ORDER BY {SORT_COLUMNS[sort_by]} {sort_order.upper()}, p.id ASC
        LIMIT ? OFFSET ?
        """,
        [*parameters, page_size, offset],
    ).fetchall()
    items = [_summary(connection, row) for row in rows]
    connection.close()
    return {
        "items": items,
        "page": page,
        "pageSize": page_size,
        "total": total,
    }


def get_paper(database_path: Path, paper_id: str) -> dict | None:
    connection = connect(database_path)
    connection.row_factory = sqlite3.Row
    row = connection.execute("SELECT * FROM papers WHERE id = ?", (paper_id,)).fetchone()
    if not row:
        connection.close()
        return None

    paper = _summary(connection, row)
    extraction = connection.execute(
        """
        SELECT * FROM extractions
        WHERE paper_id = ? AND is_latest = 1
        ORDER BY created_at DESC, id DESC LIMIT 1
        """,
        (paper_id,),
    ).fetchone()
    paper.update(
        {
            "abstract": row["abstract"],
            "source": {
                "type": "zotero",
                "externalId": row["source_item_key"],
                "url": row["url"],
            },
            "latestExtractionId": extraction["id"] if extraction else None,
            "researchOverview": (
                {
                    "researchTopics": json.loads(extraction["research_topics"]),
                    "researchQuestion": extraction["research_question"],
                    "sample": extraction["sample"],
                    "methods": extraction["methods"],
                    "mainResults": extraction["main_results"],
                }
                if extraction
                else None
            ),
        }
    )
    connection.close()
    return paper
