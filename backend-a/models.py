from dataclasses import dataclass, field


@dataclass
class AuthorRecord:
    id: str
    source_creator_id: str
    name: str
    first_name: str | None
    last_name: str | None
    role: str
    position: int


@dataclass
class AttachmentRecord:
    id: str
    path: str
    content_type: str | None


@dataclass
class PaperRecord:
    id: str
    source_library_id: int
    source_item_key: str
    item_type: str
    title: str
    abstract: str | None
    date_text: str | None
    year: int | None
    doi: str | None
    url: str | None
    journal_name: str | None
    issn: str | None
    authors: list[AuthorRecord] = field(default_factory=list)
    tags: list[str] = field(default_factory=list)
    attachments: list[AttachmentRecord] = field(default_factory=list)
    source_created_at: str | None = None
    source_updated_at: str | None = None
