"""Durable, idempotent B-to-A v0.5 analysis-result submission."""

from __future__ import annotations

from dataclasses import asdict, dataclass
from datetime import datetime, timezone
from hashlib import sha256
import json
from pathlib import Path
import socket
from typing import Literal, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen
from uuid import uuid4


SubmissionStatus = Literal["prepared", "submitting", "retrying", "timedOut", "succeeded", "failed"]

METHOD_TYPES = {
    "behavioralTask", "electrophysiology", "imaging", "intervention", "molecularCellular",
    "computationalModel", "statisticalAnalysis", "other",
}
RELATION_TYPES = {
    "supports", "contradicts", "relatedTo", "broaderThan", "cites",
}


class SubmissionError(RuntimeError):
    pass


class SubmissionNetworkError(SubmissionError):
    pass


class SubmissionTransport(Protocol):
    def post(self, task_id: str, payload_json: str) -> tuple[int, dict[str, object]]:
        """Send a previously persisted payload and return HTTP status plus JSON body."""


@dataclass(frozen=True)
class SubmissionRecord:
    submission_id: str
    task_id: str
    paper_id: str
    payload_hash: str
    payload_json: str
    status: SubmissionStatus
    retry_count: int
    last_error: str | None
    created_at: str
    updated_at: str

    @classmethod
    def from_dict(cls, value: dict[str, object]) -> "SubmissionRecord":
        return cls(
            submission_id=str(value["submission_id"]), task_id=str(value["task_id"]), paper_id=str(value["paper_id"]),
            payload_hash=str(value["payload_hash"]), payload_json=str(value["payload_json"]), status=value["status"],  # type: ignore[arg-type]
            retry_count=int(value["retry_count"]), last_error=value.get("last_error") if isinstance(value.get("last_error"), str) else None,
            created_at=str(value["created_at"]), updated_at=str(value["updated_at"]),
        )


class FileSubmissionStore:
    """One JSON file per submission; atomic replacement keeps retry state durable."""

    def __init__(self, directory: Path) -> None:
        self._directory = directory
        self._directory.mkdir(parents=True, exist_ok=True)

    def get(self, submission_id: str) -> SubmissionRecord | None:
        path = self._path(submission_id)
        if not path.exists():
            return None
        return SubmissionRecord.from_dict(json.loads(path.read_text(encoding="utf-8")))

    def save(self, record: SubmissionRecord) -> SubmissionRecord:
        path = self._path(record.submission_id)
        temporary = path.with_suffix(".tmp")
        temporary.write_text(json.dumps(asdict(record), ensure_ascii=False, sort_keys=True), encoding="utf-8")
        temporary.replace(path)
        return record

    def _path(self, submission_id: str) -> Path:
        if not submission_id or "/" in submission_id or "\\" in submission_id:
            raise SubmissionError("invalid submissionId")
        return self._directory / f"{submission_id}.json"


class AInternalHttpTransport:
    def __init__(self, base_url: str, timeout_seconds: float = 20.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds

    def post(self, task_id: str, payload_json: str) -> tuple[int, dict[str, object]]:
        request = Request(
            f"{self._base_url}/api/v1/internal/analysis-jobs/{task_id}/result",
            data=payload_json.encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST",
        )
        try:
            with urlopen(request, timeout=self._timeout_seconds) as response:
                return response.status, _decode_response(response.read())
        except HTTPError as error:
            return error.code, _decode_response(error.read())
        except (socket.timeout, TimeoutError) as error:
            raise TimeoutError(str(error)) from error
        except URLError as error:
            raise SubmissionNetworkError(str(error)) from error


class SubmissionService:
    def __init__(self, store: FileSubmissionStore, transport: SubmissionTransport) -> None:
        self._store = store
        self._transport = transport

    def prepare(self, task_id: str, paper_id: str, result: dict[str, object], submission_id: str | None = None) -> SubmissionRecord:
        submission_id = submission_id or str(uuid4())
        payload = build_submission_payload(submission_id, paper_id, result)
        payload_json = canonical_json(payload)
        payload_hash = sha256(payload_json.encode("utf-8")).hexdigest()
        existing = self._store.get(submission_id)
        if existing is not None:
            if existing.task_id != task_id or existing.paper_id != paper_id or existing.payload_hash != payload_hash:
                raise SubmissionError("submissionId already exists with a different task, paper, or payload")
            return existing
        now = utc_now()
        return self._store.save(SubmissionRecord(
            submission_id=submission_id, task_id=task_id, paper_id=paper_id, payload_hash=payload_hash,
            payload_json=payload_json, status="prepared", retry_count=0, last_error=None, created_at=now, updated_at=now,
        ))

    def submit(self, submission_id: str) -> SubmissionRecord:
        record = self._required_record(submission_id)
        if record.status == "succeeded":
            return record
        if record.status == "failed":
            raise SubmissionError("failed submissions require explicit operator intervention before retry")
        retry_count = record.retry_count + (1 if record.status in {"retrying", "timedOut"} else 0)
        record = self._save_state(record, "submitting", retry_count, None)
        try:
            status, body = self._transport.post(record.task_id, record.payload_json)
        except TimeoutError as error:
            return self._save_state(record, "timedOut", retry_count, f"timeout: {error}")
        except SubmissionNetworkError as error:
            return self._save_state(record, "retrying", retry_count, f"network: {error}")
        if status in {200, 201}:
            return self._save_state(record, "succeeded", retry_count, None)
        error = _format_api_error(status, body)
        if _is_retryable(status, body):
            return self._save_state(record, "retrying", retry_count, error)
        return self._save_state(record, "failed", retry_count, error)

    def retry(self, submission_id: str) -> SubmissionRecord:
        record = self._required_record(submission_id)
        if record.status not in {"timedOut", "retrying"}:
            raise SubmissionError(f"submission in {record.status} state cannot be retried")
        return self.submit(submission_id)

    def _required_record(self, submission_id: str) -> SubmissionRecord:
        record = self._store.get(submission_id)
        if record is None:
            raise SubmissionError("submission record not found")
        return record

    def _save_state(self, record: SubmissionRecord, status: SubmissionStatus, retry_count: int, last_error: str | None) -> SubmissionRecord:
        return self._store.save(SubmissionRecord(
            submission_id=record.submission_id, task_id=record.task_id, paper_id=record.paper_id,
            payload_hash=record.payload_hash, payload_json=record.payload_json, status=status,
            retry_count=retry_count, last_error=last_error, created_at=record.created_at, updated_at=utc_now(),
        ))


def build_submission_payload(submission_id: str, paper_id: str, result: dict[str, object]) -> dict[str, object]:
    """Create and validate the exact v0.5 BAnalysisResultSubmission envelope."""
    required = {"researchOverview", "evidence", "concepts", "methods", "findings", "relationCandidates"}
    if set(result) != required:
        raise SubmissionError("result must contain only v0.5 submission fields")
    payload = {"submissionId": submission_id, "paperId": paper_id, **result}
    validate_submission_payload(payload)
    return payload


def validate_submission_payload(payload: dict[str, object]) -> None:
    expected = {"submissionId", "paperId", "researchOverview", "evidence", "concepts", "methods", "findings", "relationCandidates"}
    if set(payload) != expected or not all(isinstance(payload[key], str) and payload[key] for key in ("submissionId", "paperId")):
        raise SubmissionError("invalid top-level BAnalysisResultSubmission")
    overview = payload["researchOverview"]
    if not isinstance(overview, dict) or set(overview) != {"researchTopics", "researchQuestion", "sample", "methods", "mainResults"}:
        raise SubmissionError("invalid ResearchOverview")
    if not isinstance(overview["researchTopics"], list) or not all(isinstance(value, str) for value in overview["researchTopics"]):
        raise SubmissionError("researchTopics must be a string array")
    for key in ("researchQuestion", "sample", "methods", "mainResults"):
        if overview[key] is not None and not isinstance(overview[key], str):
            raise SubmissionError(f"researchOverview.{key} must be string or null")
    evidence = _as_list(payload["evidence"], "evidence")
    evidence_refs = set()
    for item in evidence:
        _require_exact(item, {"clientRef", "section", "text"}, "evidence item")
        if not isinstance(item["clientRef"], str) or not item["clientRef"] or item["clientRef"] in evidence_refs:
            raise SubmissionError("evidence clientRef must be unique")
        if item["section"] is not None and not isinstance(item["section"], str):
            raise SubmissionError("evidence section must be string or null")
        if not isinstance(item["text"], str) or not item["text"].strip():
            raise SubmissionError("evidence text must be non-empty")
        evidence_refs.add(item["clientRef"])
    all_client_refs = set(evidence_refs)
    candidate_refs: set[str] = set()
    finding_refs: set[str] = set()
    for item in _as_list(payload["concepts"], "concepts"):
        _validate_entity(item, "concept", evidence_refs, all_client_refs, candidate_refs)
    for item in _as_list(payload["methods"], "methods"):
        _validate_entity(item, "method", evidence_refs, all_client_refs, candidate_refs)
    for item in _as_list(payload["findings"], "findings"):
        _require_exact(item, {"clientRef", "statement", "confidence", "evidenceRefs"}, "finding")
        _validate_client_ref(item, all_client_refs, "finding")
        finding_refs.add(item["clientRef"])
        if not isinstance(item["statement"], str) or not item["statement"].strip():
            raise SubmissionError("finding statement must be non-empty")
        _validate_confidence(item["confidence"])
        _validate_evidence_refs(item["evidenceRefs"], evidence_refs)
    for item in _as_list(payload["relationCandidates"], "relationCandidates"):
        _require_exact(item, {"source", "target", "relationType", "confidence", "evidenceRefs"}, "relation candidate")
        _validate_node_reference(item["source"], candidate_refs, finding_refs)
        _validate_node_reference(item["target"], candidate_refs, finding_refs)
        if item["relationType"] not in RELATION_TYPES:
            raise SubmissionError("unsupported relationType")
        _validate_confidence(item["confidence"])
        _validate_evidence_refs(item["evidenceRefs"], evidence_refs)


def canonical_json(value: dict[str, object]) -> str:
    return json.dumps(value, ensure_ascii=False, sort_keys=True, separators=(",", ":"))


def _validate_entity(item: object, kind: Literal["concept", "method"], evidence_refs: set[str], all_client_refs: set[str], candidate_refs: set[str]) -> None:
    required = {"clientRef", "rawText", "normalizedLabel", "matchStatus", "candidates", "extractionConfidence", "evidenceRefs"}
    if kind == "method":
        required = {"clientRef", "rawText", "normalizedLabel", "methodType", "description", "matchStatus", "candidates", "extractionConfidence", "evidenceRefs"}
    _require_exact(item, required, kind)
    assert isinstance(item, dict)
    _validate_client_ref(item, all_client_refs, kind)
    for key in ("rawText", "normalizedLabel"):
        if not isinstance(item[key], str) or not item[key].strip():
            raise SubmissionError(f"{kind}.{key} must be non-empty")
    if kind == "method":
        if item["methodType"] not in METHOD_TYPES or (item["description"] is not None and not isinstance(item["description"], str)):
            raise SubmissionError("invalid methodType or description")
    _validate_confidence(item["extractionConfidence"])
    _validate_evidence_refs(item["evidenceRefs"], evidence_refs)
    _validate_match(item, candidate_refs)


def _validate_match(item: dict[str, object], candidate_refs: set[str]) -> None:
    status, candidates = item["matchStatus"], item["candidates"]
    if status not in {"uncertain", "new"}:
        raise SubmissionError("v0.5 submission permits only uncertain or new matchStatus")
    if not isinstance(candidates, list):
        raise SubmissionError("candidates must be an array")
    new_count = 0
    for candidate in candidates:
        _require_exact(candidate, {"clientRef", "kind", "nodeId", "label", "recommendationScore"}, "resolution candidate")
        assert isinstance(candidate, dict)
        _validate_client_ref(candidate, candidate_refs, "resolution candidate")
        if not isinstance(candidate["label"], str) or not candidate["label"].strip():
            raise SubmissionError("resolution candidate label must be non-empty")
        _validate_confidence(candidate["recommendationScore"])
        if candidate["kind"] == "existing":
            if not isinstance(candidate["nodeId"], str) or not candidate["nodeId"]:
                raise SubmissionError("existing candidate requires nodeId")
        elif candidate["kind"] == "new":
            if candidate["nodeId"] is not None:
                raise SubmissionError("new candidate must not contain a formal nodeId")
            new_count += 1
        else:
            raise SubmissionError("resolution candidate kind must be existing or new")
    if status == "uncertain" and not candidates:
        raise SubmissionError("uncertain requires at least one resolution candidate")
    if status == "new" and new_count != 1:
        raise SubmissionError("new requires exactly one new resolution candidate")
    if new_count > 1:
        raise SubmissionError("each extraction permits at most one new candidate")


def _validate_client_ref(item: dict[str, object], refs: set[str], name: str) -> None:
    client_ref = item["clientRef"]
    if not isinstance(client_ref, str) or not client_ref or client_ref in refs:
        raise SubmissionError(f"{name} clientRef must be unique")
    refs.add(client_ref)


def _validate_evidence_refs(value: object, evidence_refs: set[str]) -> None:
    if not isinstance(value, list) or not value or not all(isinstance(ref, str) and ref in evidence_refs for ref in value):
        raise SubmissionError("evidenceRefs must contain submitted evidence clientRefs")


def _validate_node_reference(value: object, candidate_refs: set[str], finding_refs: set[str]) -> None:
    _require_exact(value, {"type", "value"}, "node reference")
    assert isinstance(value, dict)
    if value["type"] not in {"formalNodeId", "resolutionCandidateRef", "findingRef"} or not isinstance(value["value"], str) or not value["value"]:
        raise SubmissionError("invalid node reference")
    if value["type"] == "resolutionCandidateRef" and value["value"] not in candidate_refs:
        raise SubmissionError("relation candidate reference must target a submitted resolution candidate")
    if value["type"] == "findingRef" and value["value"] not in finding_refs:
        raise SubmissionError("relation finding reference must target a submitted finding")


def _require_exact(value: object, expected: set[str], name: str) -> None:
    if not isinstance(value, dict) or set(value) != expected:
        raise SubmissionError(f"invalid {name} fields")


def _as_list(value: object, name: str) -> list[object]:
    if not isinstance(value, list):
        raise SubmissionError(f"{name} must be an array")
    return value


def _validate_confidence(value: object) -> None:
    if value is not None and (not isinstance(value, (int, float)) or isinstance(value, bool) or not 0 <= value <= 1):
        raise SubmissionError("confidence must be null or between 0 and 1")


def _decode_response(raw: bytes) -> dict[str, object]:
    try:
        value = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        return {}
    return value if isinstance(value, dict) else {}


def _format_api_error(status: int, body: dict[str, object]) -> str:
    error = body.get("error")
    if isinstance(error, dict):
        code, message = error.get("code"), error.get("message")
        return f"HTTP {status} {code or ''}: {message or ''}".strip()
    return f"HTTP {status}"


def _is_retryable(status: int, body: dict[str, object]) -> bool:
    error = body.get("error")
    return status >= 500 or (isinstance(error, dict) and error.get("retryable") is True)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat().replace("+00:00", "Z")
