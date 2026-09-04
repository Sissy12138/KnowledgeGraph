import re
import uuid
from pathlib import Path

from httpx import ConnectError
from pyzotero import zotero

from .models import AttachmentRecord, AuthorRecord, PaperRecord


SUPPORTED_ITEM_TYPES = {
    "journalArticle",
    "preprint",
    "conferencePaper",
    "book",
    "bookSection",
}


def create_local_client():
    return zotero.Zotero("0", "user", None, local=True)


def _stable_id(kind: str, *parts: object) -> str:
    key = ":".join(str(part) for part in parts)
    return str(uuid.uuid5(uuid.NAMESPACE_URL, f"yanzhitu:{kind}:{key}"))


def _year(value: str | None) -> int | None:
    if not value:
        return None
    match = re.search(r"\b(18|19|20|21)\d{2}\b", value)
    return int(match.group()) if match else None


def _author_name(creator: dict) -> tuple[str, str | None, str | None]:
    first_name = creator.get("firstName") or None
    last_name = creator.get("lastName") or None
    name = creator.get("name") or f"{first_name or ''} {last_name or ''}"
    return name.strip(), first_name, last_name


def _pdf_attachments(client, item_key: str, zotero_root: Path) -> list[AttachmentRecord]:
    attachments = []
    for child in client.children(item_key):
        data = child.get("data", {})
        if data.get("itemType") != "attachment" or data.get("contentType") != "application/pdf":
            continue

        attachment_key = data.get("key") or child.get("key")
        path = data.get("path")
        if path and path.startswith("storage:"):
            path = str(zotero_root / "storage" / attachment_key / path.removeprefix("storage:"))
        if not path and data.get("filename"):
            path = str(zotero_root / "storage" / attachment_key / data["filename"])
        if not attachment_key or not path:
            continue

        attachments.append(
            AttachmentRecord(
                id=_stable_id("attachment", attachment_key),
                path=path,
                content_type=data.get("contentType"),
            )
        )
    return attachments


def paper_from_item(client, item: dict, zotero_root: Path) -> PaperRecord | None:
    data = item.get("data", {})
    title = (data.get("title") or "").strip()
    item_key = data.get("key") or item.get("key")
    item_type = data.get("itemType")
    if not title or not item_key or item_type not in SUPPORTED_ITEM_TYPES:
        return None

    library_id = int(item.get("library", {}).get("id") or 0)
    authors = []
    seen_names: dict[str, int] = {}
    for position, creator in enumerate(data.get("creators", [])):
        role = creator.get("creatorType")
        if role not in {"author", "bookAuthor"}:
            continue
        name, first_name, last_name = _author_name(creator)
        if not name:
            continue

        normalized_name = " ".join(name.casefold().split())
        occurrence = seen_names.get(normalized_name, 0)
        seen_names[normalized_name] = occurrence + 1
        source_creator_id = f"{library_id}:{item_key}:{normalized_name}:{occurrence}"
        authors.append(
            AuthorRecord(
                id=_stable_id("author", source_creator_id),
                source_creator_id=source_creator_id,
                name=name,
                first_name=first_name,
                last_name=last_name,
                role=role,
                position=position,
            )
        )

    date_text = data.get("date") or None
    tags = [tag["tag"] for tag in data.get("tags", []) if tag.get("tag")]
    attachments = []
    if item.get("meta", {}).get("numChildren", 0):
        attachments = _pdf_attachments(client, item_key, zotero_root)

    return PaperRecord(
        id=_stable_id("paper", library_id, item_key),
        source_library_id=library_id,
        source_item_key=item_key,
        item_type=item_type,
        title=title,
        abstract=data.get("abstractNote") or None,
        date_text=date_text,
        year=_year(date_text),
        doi=data.get("DOI") or None,
        url=data.get("url") or None,
        journal_name=data.get("publicationTitle") or None,
        issn=data.get("ISSN") or None,
        authors=authors,
        tags=tags,
        attachments=attachments,
        source_created_at=data.get("dateAdded") or None,
        source_updated_at=data.get("dateModified") or None,
    )


def read_papers(zotero_root: Path, limit: int | None = None) -> list[PaperRecord]:
    client = create_local_client()
    try:
        items = client.all_top(sort="dateModified", direction="desc")
        items = [
            item
            for item in items
            if item.get("data", {}).get("itemType") in SUPPORTED_ITEM_TYPES
        ]
        if limit is not None:
            items = items[:limit]
        papers = [
            paper
            for item in items
            if (paper := paper_from_item(client, item, zotero_root)) is not None
        ]
    except ConnectError as error:
        raise RuntimeError("无法连接 Zotero 本地接口。请先启动 Zotero，再重新执行导入命令。") from error
    finally:
        client.client.close()

    return papers
