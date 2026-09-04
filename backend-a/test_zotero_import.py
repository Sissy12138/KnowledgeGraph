import io
import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from .api import create_app
from .database import connect


def _item(key: str, title: str, modified: str, collection_keys: list[str]) -> dict:
    return {
        "key": key,
        "library": {"id": 1},
        "meta": {"numChildren": 0},
        "data": {
            "key": key,
            "itemType": "journalArticle",
            "title": title,
            "date": "2026",
            "dateAdded": "2026-09-01T00:00:00Z",
            "dateModified": modified,
            "creators": [{"creatorType": "author", "firstName": "A", "lastName": key}],
            "tags": [],
            "collections": collection_keys,
        },
    }


class FakeZoteroClient:
    collection_data = [
        {
            "library": {"id": 1},
            "data": {"key": "PARENT", "name": "父文件夹", "parentCollection": False},
            "meta": {"numItems": 1, "numCollections": 1},
        },
        {
            "library": {"id": 1},
            "data": {"key": "CHILD", "name": "子文件夹", "parentCollection": "PARENT"},
            "meta": {"numItems": 2, "numCollections": 0},
        },
    ]
    paper_1 = _item(
        "PAPER1",
        "论文一",
        "2026-09-01T00:00:00Z",
        ["PARENT", "CHILD"],
    )
    paper_1["meta"]["numChildren"] = 1
    paper_2 = _item("PAPER2", "论文二", "2026-09-02T00:00:00Z", ["CHILD"])
    items = {
        "PARENT": [paper_1],
        "CHILD": [paper_1, paper_2],
    }

    def __init__(self):
        self.client = self

    def close(self):
        pass

    def top(self, **_kwargs):
        return [self.paper_1]

    def all_top(self, **_kwargs):
        return list(
            {
                item["key"]: item for values in self.items.values() for item in values
            }.values()
        )

    def collections(self):
        return self.collection_data

    def collection_items_top(self, key, **_kwargs):
        return self.items[key]

    @staticmethod
    def everything(query):
        return query

    @staticmethod
    def children(key):
        if key != "PAPER1":
            return []
        return [
            {
                "key": "PDF1",
                "data": {
                    "key": "PDF1",
                    "itemType": "attachment",
                    "contentType": "application/pdf",
                    "path": "storage:paper1.pdf",
                },
            }
        ]


class ZoteroImportTest(unittest.TestCase):
    def setUp(self):
        FakeZoteroClient.items = {
            "PARENT": [FakeZoteroClient.paper_1],
            "CHILD": [FakeZoteroClient.paper_1, FakeZoteroClient.paper_2],
        }
        self.temp_dir = tempfile.TemporaryDirectory()
        self.database_path = Path(self.temp_dir.name) / "test.sqlite3"
        self.zotero_root = Path(self.temp_dir.name) / "Zotero"
        connect(self.database_path).close()
        self.client_patch = patch(
            "backend.zotero_import_service._open_client",
            side_effect=FakeZoteroClient,
        )
        self.client_patch.start()

    def tearDown(self):
        self.client_patch.stop()
        self.temp_dir.cleanup()

    def _request(self, method: str, path: str, body: dict | None = None):
        raw = (
            json.dumps(body, ensure_ascii=False).encode("utf-8")
            if body is not None
            else b""
        )
        environ = {
            "REQUEST_METHOD": method,
            "PATH_INFO": path,
            "QUERY_STRING": "",
            "CONTENT_LENGTH": str(len(raw)),
            "wsgi.input": io.BytesIO(raw),
        }
        captured = {}

        def start_response(status, _headers):
            captured["status"] = status

        response = b"".join(
            create_app(self.database_path, self.zotero_root)(environ, start_response)
        )
        return captured["status"], json.loads(response.decode("utf-8"))

    @staticmethod
    def _selection() -> dict:
        return {
            "mode": "collections",
            "collectionKeys": ["PARENT"],
            "includeSubcollections": True,
        }

    def test_collection_preview_import_and_sync(self):
        status, collections = self._request("GET", "/api/v1/zotero/collections")
        self.assertEqual("200 OK", status)
        self.assertEqual(2, len(collections["items"]))
        self.assertIsNone(collections["syncSelection"])

        status, preview = self._request(
            "POST", "/api/v1/zotero/import-preview", self._selection()
        )
        self.assertEqual("200 OK", status)
        self.assertEqual(2, preview["foundCount"])
        self.assertEqual(2, preview["createdCount"])
        self.assertEqual(1, preview["withPdfCount"])
        self.assertEqual(1, preview["missingPdfCount"])

        status, imported = self._request(
            "POST",
            "/api/v1/zotero/import",
            {**self._selection(), "saveAsSyncScope": True},
        )
        self.assertEqual("200 OK", status)
        self.assertEqual(2, imported["createdCount"])
        self.assertEqual(2, len(imported["paperIds"]))

        connection = connect(self.database_path)
        self.assertEqual(
            2, connection.execute("SELECT COUNT(*) FROM papers").fetchone()[0]
        )
        connection.close()

        status, papers = self._request("GET", "/api/v1/papers")
        self.assertEqual("200 OK", status)
        papers_by_title = {paper["title"]: paper for paper in papers["items"]}
        self.assertTrue(papers_by_title["论文一"]["hasPdf"])
        self.assertFalse(papers_by_title["论文二"]["hasPdf"])
        self.assertCountEqual(
            ["父文件夹", "子文件夹"],
            [value["name"] for value in papers_by_title["论文一"]["zoteroCollections"]],
        )
        self.assertEqual(
            [{"key": "CHILD", "name": "子文件夹"}],
            papers_by_title["论文二"]["zoteroCollections"],
        )

        status, synced = self._request("POST", "/api/v1/zotero/sync")
        self.assertEqual("200 OK", status)
        self.assertEqual(2, synced["unchangedCount"])

        FakeZoteroClient.items["CHILD"].append(
            _item("PAPER3", "论文三", "2026-09-03T00:00:00Z", ["CHILD"])
        )
        status, synced = self._request("POST", "/api/v1/zotero/sync")
        self.assertEqual("200 OK", status)
        self.assertEqual(1, synced["createdCount"])

    def test_unknown_collection_is_rejected(self):
        status, response = self._request("POST", "/api/v1/zotero/sync")
        self.assertEqual("409 Conflict", status)
        self.assertEqual("ZOTERO_SYNC_SCOPE_NOT_SET", response["error"]["code"])

        status, response = self._request(
            "POST",
            "/api/v1/zotero/import-preview",
            {
                "mode": "collections",
                "collectionKeys": ["MISSING"],
                "includeSubcollections": False,
            },
        )
        self.assertEqual("404 Not Found", status)
        self.assertEqual("ZOTERO_COLLECTION_NOT_FOUND", response["error"]["code"])


if __name__ == "__main__":
    unittest.main()
