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
        SELECT a.id, a.name, pa.position, pa.role
        FROM paper_authors pa
        JOIN authors a ON a.id = pa.author_id
        WHERE pa.paper_id = ?
        ORDER BY pa.position, a.id
        """,
        (paper_id,),
    ).fetchall()
    authors: dict[str, dict] = {}
    for row in rows:
        author = authors.setdefault(
            row["id"],
            {
                "authorId": row["id"],
                "displayName": row["name"],
                "rawName": row["name"],
                "authorOrder": row["position"] + 1,
                "contributionRoles": [],
            },
        )
        author["authorOrder"] = min(author["authorOrder"], row["position"] + 1)
        normalized_role = "".join(character for character in row["role"].casefold() if character.isalnum())
        if normalized_role in {"cofirstauthor", "equalcontribution", "jointfirstauthor"}:
            author["contributionRoles"].append("coFirstAuthor")
        if normalized_role in {"correspondingauthor", "correspondenceauthor"}:
            author["contributionRoles"].append("correspondingAuthor")

    for author in authors.values():
        if author["authorOrder"] == 1:
            author["contributionRoles"].insert(0, "firstAuthor")
        author["contributionRoles"] = list(dict.fromkeys(author["contributionRoles"]))
    return sorted(authors.values(), key=lambda author: (author["authorOrder"], author["authorId"]))


def _journal(row: sqlite3.Row) -> dict | None:
    if not row["journal_name"]:
        return None
    return {
        "name": row["journal_name"],
        "issn": row["issn"],
        "metrics": None,
    }


def _zotero_collections(connection: sqlite3.Connection, paper_id: str) -> list[dict]:
    rows = connection.execute(
        """
        SELECT c.collection_key, c.name
        FROM paper_zotero_collections pc
        JOIN zotero_collections c
          ON c.source_library_id = pc.source_library_id
         AND c.collection_key = pc.collection_key
        WHERE pc.paper_id = ?
        ORDER BY c.name, c.collection_key
        """,
        (paper_id,),
    ).fetchall()
    return [{"key": row["collection_key"], "name": row["name"]} for row in rows]


def _summary(connection: sqlite3.Connection, row: sqlite3.Row) -> dict:
    return {
        "id": row["id"],
        "title": row["title"],
        "authors": _authors(connection, row["id"]),
        "year": row["year"],
        "doi": row["doi"],
        "journal": _journal(row),
        "hasPdf": bool(
            connection.execute(
                "SELECT 1 FROM paper_attachments WHERE paper_id = ? LIMIT 1",
                (row["id"],),
            ).fetchone()
        ),
        "zoteroCollections": _zotero_collections(connection, row["id"]),
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
    overview_original = (
        connection.execute(
            "SELECT * FROM research_overview_originals WHERE extraction_id = ?",
            (extraction["id"],),
        ).fetchone()
        if extraction
        else None
    )
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
                    "original": (
                        {
                            "researchTopics": json.loads(overview_original["research_topics"]),
                            "researchQuestion": overview_original["research_question"],
                            "sample": overview_original["sample"],
                            "methods": overview_original["methods"],
                            "mainResults": overview_original["main_results"],
                        }
                        if overview_original
                        else None
                    ),
                }
                if extraction
                else None
            ),
            "attachments": [
                {"id": attachment["id"], "path": attachment["path"], "contentType": attachment["content_type"]}
                for attachment in connection.execute(
                    "SELECT id, path, content_type FROM paper_attachments WHERE paper_id = ? ORDER BY id",
                    (paper_id,),
                ).fetchall()
            ],
        }
    )
    connection.close()
    return paper


def get_author(database_path: Path, author_id: str) -> dict | None:
    connection = connect(database_path)
    connection.row_factory = sqlite3.Row
    row = connection.execute("SELECT * FROM authors WHERE id = ?", (author_id,)).fetchone()
    if not row:
        connection.close()
        return None
    paper_count = connection.execute(
        "SELECT COUNT(*) FROM paper_authors WHERE author_id = ?", (author_id,)
    ).fetchone()[0]
    result = {
        "id": row["id"],
        "displayName": row["name"],
        "nameVariants": [row["name"]],
        "externalIds": {
            "orcid": row["orcid"],
            "orcidSource": "zotero" if row["orcid"] else None,
            "orcidAuthenticated": False,
        },
        "affiliations": [],
        "identityStatus": "provisional",
        "mergedIntoAuthorId": None,
        "paperCount": paper_count,
        "createdAt": _utc(row["created_at"]),
        "updatedAt": _utc(row["updated_at"]),
    }
    connection.close()
    return result

def remove_paper(database_path: Path, paper_id: str) -> bool:
    connection = connect(database_path)
    cursor = connection.execute("DELETE FROM papers WHERE id = ?", (paper_id,))
    connection.commit()
    connection.close()
    return cursor.rowcount > 0
