import json
from pathlib import Path

from httpx import ConnectError

from .database import connect, import_papers
from .models import PaperRecord, ZoteroCollectionRecord
from .zotero_service import SUPPORTED_ITEM_TYPES, create_local_client, paper_from_item


class ZoteroImportError(Exception):
    def __init__(
        self,
        status: int,
        code: str,
        message: str,
        details: dict | None = None,
    ):
        super().__init__(message)
        self.status = status
        self.code = code
        self.details = details


def _selection(body: dict) -> dict:
    mode = body.get("mode")
    collection_keys = body.get("collectionKeys")
    include_subcollections = body.get("includeSubcollections")

    if mode not in {"library", "collections"}:
        raise ZoteroImportError(
            400, "INVALID_ZOTERO_SELECTION", "mode 必须是 library 或 collections"
        )
    if not isinstance(collection_keys, list) or not all(
        isinstance(key, str) and key.strip() for key in collection_keys
    ):
        raise ZoteroImportError(
            400, "INVALID_ZOTERO_SELECTION", "collectionKeys 必须是字符串数组"
        )
    if not isinstance(include_subcollections, bool):
        raise ZoteroImportError(
            400, "INVALID_ZOTERO_SELECTION", "includeSubcollections 必须是布尔值"
        )

    collection_keys = list(dict.fromkeys(key.strip() for key in collection_keys))
    if mode == "library" and (collection_keys or include_subcollections):
        raise ZoteroImportError(
            400,
            "INVALID_ZOTERO_SELECTION",
            "library 模式要求 collectionKeys=[] 且 includeSubcollections=false",
        )
    if mode == "collections" and not collection_keys:
        raise ZoteroImportError(
            400, "INVALID_ZOTERO_SELECTION", "collections 模式至少选择一个文件夹"
        )

    return {
        "mode": mode,
        "collectionKeys": collection_keys,
        "includeSubcollections": include_subcollections,
    }


def _collection_summary(collection: dict) -> dict:
    data = collection["data"]
    meta = collection.get("meta", {})
    parent = data.get("parentCollection")
    return {
        "key": data["key"],
        "name": data["name"],
        "parentCollectionKey": parent if isinstance(parent, str) else None,
        "directItemCount": int(meta.get("numItems", 0)),
        "childCollectionCount": int(meta.get("numCollections", 0)),
    }


def _collection_record(collection: dict) -> ZoteroCollectionRecord:
    data = collection["data"]
    meta = collection.get("meta", {})
    parent = data.get("parentCollection")
    return ZoteroCollectionRecord(
        source_library_id=int(collection.get("library", {}).get("id") or 0),
        key=data["key"],
        name=data["name"],
        parent_key=parent if isinstance(parent, str) else None,
        direct_item_count=int(meta.get("numItems", 0)),
        child_collection_count=int(meta.get("numCollections", 0)),
    )


def _open_client():
    return create_local_client()


def get_zotero_status() -> dict:
    client = _open_client()
    try:
        client.top(limit=1)
        return {"connected": True}
    except ConnectError:
        return {"connected": False}
    finally:
        client.client.close()


def _saved_selection(database_path: Path) -> dict | None:
    connection = connect(database_path)
    row = connection.execute(
        "SELECT mode, collection_keys, include_subcollections FROM zotero_sync_scope WHERE id = 1"
    ).fetchone()
    connection.close()
    if row is None:
        return None
    return {
        "mode": row[0],
        "collectionKeys": json.loads(row[1]),
        "includeSubcollections": bool(row[2]),
    }


def list_zotero_collections(database_path: Path) -> dict:
    client = _open_client()
    try:
        collections = [
            _collection_summary(value)
            for value in client.everything(client.collections())
        ]
    except ConnectError as error:
        raise ZoteroImportError(
            503, "ZOTERO_UNAVAILABLE", "无法连接 Zotero 本地接口"
        ) from error
    finally:
        client.client.close()
    collections.sort(key=lambda value: (value["name"].casefold(), value["key"]))
    return {"items": collections, "syncSelection": _saved_selection(database_path)}


def _selected_collection_keys(collections: list[dict], selection: dict) -> list[str]:
    by_key = {value["data"]["key"]: value for value in collections}
    missing = [key for key in selection["collectionKeys"] if key not in by_key]
    if missing:
        raise ZoteroImportError(
            404,
            "ZOTERO_COLLECTION_NOT_FOUND",
            "未找到指定 Zotero 文件夹",
            {"collectionKeys": missing},
        )

    selected = set(selection["collectionKeys"])
    if selection["includeSubcollections"]:
        changed = True
        while changed:
            changed = False
            for key, collection in by_key.items():
                if (
                    collection["data"].get("parentCollection") in selected
                    and key not in selected
                ):
                    selected.add(key)
                    changed = True
    return sorted(selected)


def _read_selected_papers(
    selection: dict,
    zotero_root: Path,
) -> tuple[list[PaperRecord], int, list[ZoteroCollectionRecord]]:
    client = _open_client()
    try:
        raw_collections = client.everything(client.collections())
        collection_records = [_collection_record(value) for value in raw_collections]
        if selection["mode"] == "library":
            items = client.all_top(sort="dateModified", direction="desc")
        else:
            keys = _selected_collection_keys(raw_collections, selection)
            items_by_key = {}
            for key in keys:
                items = client.everything(
                    client.collection_items_top(
                        key, sort="dateModified", direction="desc"
                    )
                )
                for item in items:
                    data = item.get("data", {})
                    item_key = data.get("key") or item.get("key")
                    library_id = int(item.get("library", {}).get("id") or 0)
                    if item_key:
                        items_by_key[(library_id, item_key)] = item
            items = list(items_by_key.values())

        found_count = len(items)
        papers = []
        for item in items:
            if item.get("data", {}).get("itemType") not in SUPPORTED_ITEM_TYPES:
                continue
            paper = paper_from_item(client, item, zotero_root)
            if paper is not None:
                papers.append(paper)
        return papers, found_count, collection_records
    except ConnectError as error:
        raise ZoteroImportError(
            503, "ZOTERO_UNAVAILABLE", "无法连接 Zotero 本地接口"
        ) from error
    finally:
        client.client.close()


def _classify(database_path: Path, papers: list[PaperRecord], found_count: int) -> dict:
    connection = connect(database_path)
    created_count = 0
    updated_count = 0
    unchanged_count = 0
    for paper in papers:
        row = connection.execute(
            """
            SELECT source_updated_at
            FROM papers
            WHERE source_type = 'zotero'
              AND source_library_id = ?
              AND source_item_key = ?
            """,
            (paper.source_library_id, paper.source_item_key),
        ).fetchone()
        if row is None:
            created_count += 1
        elif row[0] != paper.source_updated_at:
            updated_count += 1
        else:
            unchanged_count += 1
    connection.close()
    return {
        "foundCount": found_count,
        "importableCount": len(papers),
        "createdCount": created_count,
        "updatedCount": updated_count,
        "unchangedCount": unchanged_count,
        "withPdfCount": sum(bool(paper.attachments) for paper in papers),
        "missingPdfCount": sum(not paper.attachments for paper in papers),
        "skippedCount": found_count - len(papers),
    }


def preview_zotero_import(database_path: Path, zotero_root: Path, body: dict) -> dict:
    selection = _selection(body)
    papers, found_count, _collections = _read_selected_papers(selection, zotero_root)
    return {"selection": selection, **_classify(database_path, papers, found_count)}


def _save_selection(database_path: Path, selection: dict) -> None:
    connection = connect(database_path)
    with connection:
        connection.execute(
            """
            INSERT INTO zotero_sync_scope (
                id, mode, collection_keys, include_subcollections
            ) VALUES (1, ?, ?, ?)
            ON CONFLICT(id) DO UPDATE SET
                mode = excluded.mode,
                collection_keys = excluded.collection_keys,
                include_subcollections = excluded.include_subcollections,
                updated_at = CURRENT_TIMESTAMP
            """,
            (
                selection["mode"],
                json.dumps(selection["collectionKeys"], ensure_ascii=False),
                int(selection["includeSubcollections"]),
            ),
        )
    connection.close()


def _paper_ids(database_path: Path, papers: list[PaperRecord]) -> list[str]:
    connection = connect(database_path)
    ids = []
    for paper in papers:
        row = connection.execute(
            """
            SELECT id FROM papers
            WHERE source_type = 'zotero'
              AND source_library_id = ?
              AND source_item_key = ?
            """,
            (paper.source_library_id, paper.source_item_key),
        ).fetchone()
        ids.append(row[0])
    connection.close()
    return ids


def import_zotero_selection(database_path: Path, zotero_root: Path, body: dict) -> dict:
    selection = _selection(body)
    save_as_sync_scope = body.get("saveAsSyncScope", True)
    if not isinstance(save_as_sync_scope, bool):
        raise ZoteroImportError(
            400, "INVALID_ZOTERO_SELECTION", "saveAsSyncScope 必须是布尔值"
        )

    papers, found_count, collections = _read_selected_papers(selection, zotero_root)
    result = _classify(database_path, papers, found_count)
    import_papers(database_path, papers, collections)
    if save_as_sync_scope:
        _save_selection(database_path, selection)
    return {
        "selection": selection,
        **result,
        "paperIds": _paper_ids(database_path, papers),
        "syncScopeSaved": save_as_sync_scope,
    }


def sync_zotero(database_path: Path, zotero_root: Path) -> dict:
    selection = _saved_selection(database_path)
    if selection is None:
        raise ZoteroImportError(
            409, "ZOTERO_SYNC_SCOPE_NOT_SET", "尚未保存 Zotero 同步范围"
        )
    return import_zotero_selection(
        database_path,
        zotero_root,
        {**selection, "saveAsSyncScope": False},
    )
