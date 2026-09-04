"""Parse text-based scholarly PDFs into the existing extraction input model."""

from __future__ import annotations

from dataclasses import dataclass
from hashlib import sha256
from pathlib import Path
import re
from typing import Literal

from pypdf import PdfReader
from pypdf.errors import PdfReadError

from .paper_extraction import PaperChunk, PaperDocument, PaperReference, PaperSection


PdfParseErrorCode = Literal[
    "FILE_NOT_FOUND",
    "INVALID_PDF",
    "ENCRYPTED_PDF",
    "TEXT_EXTRACTION_FAILED",
    "NO_EXTRACTABLE_TEXT",
]


class PdfParseError(RuntimeError):
    """A caller-visible PDF failure. OCR is deliberately not attempted here."""

    def __init__(self, code: PdfParseErrorCode, message: str) -> None:
        super().__init__(message)
        self.code = code


@dataclass(frozen=True)
class _TextSlice:
    section: str
    page: int
    start: int
    end: int
    text: str


_DOI = re.compile(r"\b10\.\d{4,9}/[-._;()/:A-Z0-9]+", re.IGNORECASE)
_YEAR = re.compile(r"(?<!\d)(?:19|20)\d{2}")
_KNOWN_HEADINGS = {
    "abstract": "Abstract",
    "introduction": "Introduction",
    "background": "Background",
    "related work": "Related Work",
    "methods": "Methods",
    "method": "Methods",
    "materials and methods": "Methods",
    "materials & methods": "Methods",
    "methodology": "Methods",
    "results": "Results",
    "findings": "Findings",
    "discussion": "Discussion",
    "conclusion": "Conclusion",
    "conclusions": "Conclusion",
    "limitations": "Limitations",
    "acknowledgements": "Acknowledgements",
    "acknowledgments": "Acknowledgements",
    "references": "References",
    "bibliography": "References",
}


class PdfPaperParser:
    """Text-PDF parser with deterministic sectioning and chunk identifiers."""

    def __init__(self, chunk_size: int = 1800, overlap: int = 180) -> None:
        if chunk_size <= 0 or not 0 <= overlap < chunk_size:
            raise ValueError("chunk_size must be positive and overlap must be smaller than chunk_size")
        self._chunk_size = chunk_size
        self._overlap = overlap

    def parse(self, pdf_path: str | Path, paper_id: str | None = None) -> PaperDocument:
        path = Path(pdf_path)
        if not path.is_file():
            raise PdfParseError("FILE_NOT_FOUND", f"PDF file does not exist: {path}")
        try:
            reader = PdfReader(str(path))
        except PdfReadError as error:
            raise PdfParseError("INVALID_PDF", f"Unable to read PDF: {error}") from error
        except OSError as error:
            raise PdfParseError("INVALID_PDF", f"Unable to open PDF: {error}") from error
        if reader.is_encrypted:
            raise PdfParseError("ENCRYPTED_PDF", "Encrypted PDFs are not supported")

        pages = self._extract_pages(reader)
        all_text = "\n".join(pages)
        if len(re.sub(r"\s+", "", all_text)) < 120:
            raise PdfParseError(
                "NO_EXTRACTABLE_TEXT",
                "PDF has insufficient embedded text; it is likely scanned, image-only, or malformed",
            )

        resolved_id = paper_id or f"pdf_{sha256(path.read_bytes()).hexdigest()[:16]}"
        slices = self._section_slices(pages)
        sections = self._build_sections(slices)
        metadata = self._metadata(reader, pages, sections)
        chunks = self._build_chunks(resolved_id, slices)
        references = self._references(sections)
        if not chunks:
            raise PdfParseError("NO_EXTRACTABLE_TEXT", "PDF text could not be converted into chunks")
        return PaperDocument(resolved_id, metadata, chunks, sections, references)

    @staticmethod
    def _extract_pages(reader: PdfReader) -> list[str]:
        pages: list[str] = []
        try:
            for page in reader.pages:
                text = page.extract_text(extraction_mode="layout") or page.extract_text() or ""
                text = text.replace("\r\n", "\n").replace("\r", "\n").replace("\x00", "")
                pages.append(text)
        except Exception as error:  # pypdf has several backend-specific extraction errors.
            raise PdfParseError("TEXT_EXTRACTION_FAILED", f"Embedded text extraction failed: {error}") from error
        return pages

    def _section_slices(self, pages: list[str]) -> list[_TextSlice]:
        current_section = "Front Matter"
        slices: list[_TextSlice] = []
        for page_number, page_text in enumerate(pages, start=1):
            line_start = 0
            content_start = 0
            for raw_line in page_text.splitlines(keepends=True):
                line_end = line_start + len(raw_line)
                heading = self._heading_name(raw_line)
                if heading:
                    self._append_slice(slices, current_section, page_number, page_text, content_start, line_start)
                    current_section = heading
                    content_start = line_end
                line_start = line_end
            self._append_slice(slices, current_section, page_number, page_text, content_start, len(page_text))
        return slices

    @staticmethod
    def _append_slice(
        slices: list[_TextSlice], section: str, page: int, page_text: str, start: int, end: int
    ) -> None:
        raw = page_text[start:end]
        leading = len(raw) - len(raw.lstrip())
        trailing = len(raw) - len(raw.rstrip())
        clean = raw.strip()
        if clean:
            slices.append(_TextSlice(section, page, start + leading, end - trailing, clean))

    @staticmethod
    def _heading_name(raw_line: str) -> str | None:
        line = re.sub(r"\s+", " ", raw_line).strip()
        if not line or len(line) > 100:
            return None
        without_number = re.sub(r"^(?:\d+(?:\.\d+)*|[IVXLCDM]+)[.\s]+", "", line, flags=re.IGNORECASE)
        normalized = without_number.casefold().rstrip(":")
        if normalized in _KNOWN_HEADINGS:
            return _KNOWN_HEADINGS[normalized]
        # Layout extraction can put the first words of a second column on the
        # heading line, e.g. "Abstract There are two existing strategies...".
        for label, heading in _KNOWN_HEADINGS.items():
            if normalized.startswith(f"{label} "):
                return heading
        numbered = re.match(r"^\d+(?:\.\d+)*\s+([A-Z][A-Za-z &/-]{2,80}?)(?:\s{2,}|$)", raw_line.strip())
        if numbered:
            candidate = numbered.group(1).strip()
            return _KNOWN_HEADINGS.get(candidate.casefold(), candidate)
        # Numbered title-style headings allow documents with less conventional labels.
        if without_number != line and re.fullmatch(r"[A-Z][A-Za-z &/-]{2,80}", without_number):
            return without_number.strip()
        return None

    def _build_chunks(self, paper_id: str, slices: list[_TextSlice]) -> list[PaperChunk]:
        chunks: list[PaperChunk] = []
        for source in slices:
            start = 0
            while start < len(source.text):
                end = min(start + self._chunk_size, len(source.text))
                if end < len(source.text):
                    boundary = source.text.rfind(" ", start, end)
                    if boundary > start:
                        end = boundary
                raw = source.text[start:end]
                leading = len(raw) - len(raw.lstrip())
                content = raw.strip()
                if content:
                    absolute_start = source.start + start + leading
                    absolute_end = absolute_start + len(content)
                    digest = sha256(
                        f"{paper_id}:{source.section}:{source.page}:{absolute_start}:{content}".encode()
                    ).hexdigest()[:16]
                    chunks.append(PaperChunk(
                        section=source.section,
                        chunk_id=f"chunk_{digest}",
                        chunk_text=content,
                        page=source.page,
                        position={"pageCharStart": absolute_start, "pageCharEnd": absolute_end},
                    ))
                if end >= len(source.text):
                    break
                start = max(end - self._overlap, start + 1)
        return chunks

    @staticmethod
    def _build_sections(slices: list[_TextSlice]) -> list[PaperSection]:
        grouped: list[list[_TextSlice]] = []
        for source in slices:
            if grouped and grouped[-1][0].section == source.section:
                grouped[-1].append(source)
            else:
                grouped.append([source])
        return [
            PaperSection(
                name=group[0].section,
                text="\n\n".join(item.text for item in group),
                page_start=group[0].page,
                page_end=group[-1].page,
            )
            for group in grouped
        ]

    @staticmethod
    def _metadata(reader: PdfReader, pages: list[str], sections: list[PaperSection]) -> dict[str, object]:
        document_metadata = reader.metadata or {}
        first_page = pages[0] if pages else ""
        title = PdfPaperParser._valid_metadata_string(document_metadata.get("/Title")) or PdfPaperParser._title(first_page)
        authors = PdfPaperParser._authors(document_metadata.get("/Author"), first_page)
        doi = PdfPaperParser._doi(first_page) or PdfPaperParser._doi("\n".join(page for page in pages[:3]))
        abstract = next((section.text for section in sections if section.name.casefold() == "abstract"), None)
        abstract = abstract or PdfPaperParser._abstract_from_first_page(first_page)
        year = PdfPaperParser._year(document_metadata.get("/CreationDate")) or PdfPaperParser._year(first_page)
        return {"title": title, "authors": authors, "year": year, "doi": doi, "abstract": abstract}

    @staticmethod
    def _valid_metadata_string(value: object) -> str | None:
        if not isinstance(value, str):
            return None
        normalized = re.sub(r"\s+", " ", value).strip()
        return normalized if normalized and normalized.casefold() not in {"untitled", "unknown"} else None

    @staticmethod
    def _title(first_page: str) -> str | None:
        lines = [re.sub(r"\s+", " ", line).strip() for line in first_page.splitlines()]
        useful = []
        for line in lines:
            if not line:
                continue
            if re.search(r"^(abstract|arxiv:|\[\d{4}\.\d+)", line, re.IGNORECASE):
                break
            if len(line) > 110 or re.search(r"^(provided|reproduce|published as|copyright|proceedings)", line, re.IGNORECASE):
                continue
            if line.endswith("."):
                continue
            if "@" in line or re.search(r"\b(university|department|institute|laboratory)\b", line, re.IGNORECASE):
                continue
            if len(re.sub(r"[^A-Za-z]", "", line)) >= 5:
                useful.append(line)
            if len(useful) == 2:
                break
        return " ".join(useful)[:300] or None

    @staticmethod
    def _abstract_from_first_page(first_page: str) -> str | None:
        match = re.search(
            r"\bAbstract\b\s*(.*?)(?=\n\s*(?:\d+(?:\.\d+)*\s+)?Introduction\b|\Z)",
            first_page,
            re.IGNORECASE | re.DOTALL,
        )
        if not match:
            return None
        abstract = re.sub(r"\s+", " ", match.group(1)).strip()
        return abstract or None

    @staticmethod
    def _authors(metadata_author: object, first_page: str) -> list[str]:
        if isinstance(metadata_author, str) and metadata_author.strip():
            return [item.strip() for item in re.split(r"\s*;\s*|\s+and\s+", metadata_author) if item.strip()]
        before_abstract = first_page.split("Abstract", 1)[0]
        for line in before_abstract.splitlines()[1:20]:
            normalized = re.sub(r"\s+", " ", line).strip()
            if re.search(r"\b(and|,|·)\b", normalized) and not re.search(r"@|university|department", normalized, re.IGNORECASE):
                parts = [item.strip() for item in re.split(r",|\band\b|·", normalized) if item.strip()]
                if 1 < len(parts) <= 20 and all(len(part) < 80 for part in parts):
                    return parts
        return []

    @staticmethod
    def _doi(text: str) -> str | None:
        match = _DOI.search(text)
        return match.group(0).rstrip(".,;)") if match else None

    @staticmethod
    def _year(value: object) -> int | None:
        if not isinstance(value, str):
            return None
        match = _YEAR.search(value)
        return int(match.group(0)) if match else None

    @staticmethod
    def _references(sections: list[PaperSection]) -> list[PaperReference]:
        references: list[PaperReference] = []
        for section in sections:
            if section.name.casefold() != "references":
                continue
            entries = re.split(r"(?m)(?=^\s*(?:\[\d+\]|\d+\.))", section.text)
            for entry in entries:
                raw = re.sub(r"\s+", " ", entry).strip()
                if raw:
                    references.append(PaperReference(raw, PdfPaperParser._doi(raw)))
        return references
