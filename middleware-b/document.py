"""Deterministic text preparation and evidence traceability."""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
import re

from .models import Evidence


@dataclass(frozen=True)
class DocumentSection:
    name: str
    text: str


@dataclass(frozen=True)
class DocumentChunk:
    id: str
    paper_id: str
    section: str
    index: int
    text: str

    def evidence_for(self, text: str) -> Evidence:
        if not text.strip() or text not in self.text:
            raise ValueError("evidence text must be a non-empty exact excerpt of its chunk")
        digest = sha256(f"{self.id}:{text}".encode()).hexdigest()[:16]
        return Evidence(id=f"evidence_{digest}", paper_id=self.paper_id, section=self.section, text=text)


def split_sections(text: str) -> list[DocumentSection]:
    """Split Markdown-style headings while retaining a usable fallback section."""
    heading = re.compile(r"(?m)^#{1,6}\s+(.+?)\s*$")
    matches = list(heading.finditer(text))
    if not matches:
        content = text.strip()
        return [DocumentSection("Full Text", content)] if content else []
    sections: list[DocumentSection] = []
    prefix = text[: matches[0].start()].strip()
    if prefix:
        sections.append(DocumentSection("Full Text", prefix))
    for index, match in enumerate(matches):
        end = matches[index + 1].start() if index + 1 < len(matches) else len(text)
        content = text[match.end() : end].strip()
        if content:
            sections.append(DocumentSection(match.group(1), content))
    return sections


def chunk_sections(paper_id: str, sections: list[DocumentSection], chunk_size: int = 1800, overlap: int = 180) -> list[DocumentChunk]:
    if chunk_size <= 0 or not 0 <= overlap < chunk_size:
        raise ValueError("chunk_size must be positive and overlap must be smaller than chunk_size")
    chunks: list[DocumentChunk] = []
    for section in sections:
        start = 0
        index = 0
        while start < len(section.text):
            end = min(start + chunk_size, len(section.text))
            if end < len(section.text):
                boundary = section.text.rfind(" ", start, end)
                if boundary > start:
                    end = boundary
            content = section.text[start:end].strip()
            if content:
                digest = sha256(f"{paper_id}:{section.name}:{index}:{content}".encode()).hexdigest()[:16]
                chunks.append(DocumentChunk(f"chunk_{digest}", paper_id, section.name, index, content))
                index += 1
            if end >= len(section.text):
                break
            start = max(end - overlap, start + 1)
    return chunks
