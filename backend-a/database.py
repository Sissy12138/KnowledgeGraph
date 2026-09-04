import sqlite3
from pathlib import Path

from .models import PaperRecord, ZoteroCollectionRecord


SCHEMA_PATH = Path(__file__).with_name("schema.sql")


def connect(database_path: Path) -> sqlite3.Connection:
    database_path.parent.mkdir(parents=True, exist_ok=True)
    connection = sqlite3.connect(database_path)
    connection.execute("PRAGMA foreign_keys = ON")
    connection.executescript(SCHEMA_PATH.read_text(encoding="utf-8"))
    return connection


def import_papers(
    database_path: Path,
    papers: list[PaperRecord],
    collections: list[ZoteroCollectionRecord] | None = None,
) -> int:
    connection = connect(database_path)
    written_count = 0
    with connection:
        if collections is not None:
            connection.executemany(
                """
                INSERT INTO zotero_collections (
                    source_library_id, collection_key, name, parent_collection_key,
                    direct_item_count, child_collection_count
                ) VALUES (?, ?, ?, ?, ?, ?)
                ON CONFLICT(source_library_id, collection_key) DO UPDATE SET
                    name = excluded.name,
                    parent_collection_key = excluded.parent_collection_key,
                    direct_item_count = excluded.direct_item_count,
                    child_collection_count = excluded.child_collection_count,
                    updated_at = CURRENT_TIMESTAMP
                """,
                [
                    (
                        collection.source_library_id,
                        collection.key,
                        collection.name,
                        collection.parent_key,
                        collection.direct_item_count,
                        collection.child_collection_count,
                    )
                    for collection in collections
                ],
            )
        known_collections = {
            (collection.source_library_id, collection.key)
            for collection in collections or []
        }

        for paper in papers:
            existing = connection.execute(
                """
                SELECT id, source_updated_at
                FROM papers
                WHERE source_type = 'zotero'
                  AND source_library_id = ?
                  AND source_item_key = ?
                ORDER BY created_at, id
                LIMIT 1
                """,
                (paper.source_library_id, paper.source_item_key),
            ).fetchone()
            paper_id = existing[0] if existing else paper.id
            unchanged = existing and existing[1] == paper.source_updated_at

            if not unchanged:
                connection.execute(
                    """
                INSERT INTO papers (
                    id, source_type, source_library_id, source_item_key, item_type,
                    title, abstract, date_text, year, doi, url, journal_name, issn,
                    source_created_at, source_updated_at
                ) VALUES (?, 'zotero', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                ON CONFLICT(id) DO UPDATE SET
                    source_library_id = excluded.source_library_id,
                    item_type = excluded.item_type,
                    title = excluded.title,
                    abstract = excluded.abstract,
                    date_text = excluded.date_text,
                    year = excluded.year,
                    doi = excluded.doi,
                    url = excluded.url,
                    journal_name = excluded.journal_name,
                    issn = excluded.issn,
                    source_updated_at = excluded.source_updated_at,
                    updated_at = CURRENT_TIMESTAMP
                """,
                    (
                        paper_id,
                        paper.source_library_id,
                        paper.source_item_key,
                        paper.item_type,
                        paper.title,
                        paper.abstract,
                        paper.date_text,
                        paper.year,
                        paper.doi,
                        paper.url,
                        paper.journal_name,
                        paper.issn,
                        paper.source_created_at,
                        paper.source_updated_at,
                    ),
                )

                connection.execute(
                    "DELETE FROM paper_authors WHERE paper_id = ?", (paper_id,)
                )
                for author in paper.authors:
                    connection.execute(
                        """
                    INSERT INTO authors (
                        id, source_type, source_creator_id, name, first_name, last_name
                    ) VALUES (?, 'zotero', ?, ?, ?, ?)
                    ON CONFLICT(id) DO UPDATE SET
                        name = excluded.name,
                        first_name = excluded.first_name,
                        last_name = excluded.last_name,
                        updated_at = CURRENT_TIMESTAMP
                    """,
                        (
                            author.id,
                            author.source_creator_id,
                            author.name,
                            author.first_name,
                            author.last_name,
                        ),
                    )
                    connection.execute(
                        """
                    INSERT INTO paper_authors (paper_id, author_id, role, position)
                    VALUES (?, ?, ?, ?)
                    """,
                        (paper_id, author.id, author.role, author.position),
                    )

                connection.execute(
                    "DELETE FROM paper_tags WHERE paper_id = ?", (paper_id,)
                )
                connection.executemany(
                    "INSERT INTO paper_tags (paper_id, tag) VALUES (?, ?)",
                    [(paper_id, tag) for tag in paper.tags],
                )

                written_count += 1

            connection.execute(
                "DELETE FROM paper_attachments WHERE paper_id = ?", (paper_id,)
            )
            connection.executemany(
                """
                INSERT INTO paper_attachments (id, paper_id, path, content_type)
                VALUES (?, ?, ?, ?)
                """,
                [
                    (
                        attachment.id,
                        paper_id,
                        attachment.path,
                        attachment.content_type,
                    )
                    for attachment in paper.attachments
                ],
            )

            if collections is not None:
                connection.execute(
                    "DELETE FROM paper_zotero_collections WHERE paper_id = ?",
                    (paper_id,),
                )
                connection.executemany(
                    """
                    INSERT INTO paper_zotero_collections (
                        paper_id, source_library_id, collection_key
                    ) VALUES (?, ?, ?)
                    """,
                    [
                        (paper_id, paper.source_library_id, key)
                        for key in paper.collection_keys
                        if (paper.source_library_id, key) in known_collections
                    ],
                )

    connection.close()
    return written_count
