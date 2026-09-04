"""Task-scoped v0.5 Concept/Method candidate lookup and review decisions."""

from __future__ import annotations

from dataclasses import dataclass
import json
import re
import socket
from typing import Literal, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .agent_prompts.entity_match import INSTRUCTION, OUTPUT_TEMPLATE
from .model_client import ModelClient

EntityType = Literal["concept", "method"]
MatchStatus = Literal["matched", "uncertain", "new"]


class CandidateQueryError(RuntimeError):
    def __init__(self, message: str, retryable: bool) -> None:
        super().__init__(message)
        self.retryable = retryable


class NormalizationError(RuntimeError):
    pass


@dataclass(frozen=True)
class RawEntity:
    source_term: str
    display_name: str
    entity_type: EntityType
    context: str | None
    evidence_client_refs: list[str]


@dataclass(frozen=True)
class MatchCandidate:
    entity_id: str
    canonical_name: str
    recommendation_score: float | None
    evidence: list[str]

    def to_v05_context(self) -> dict[str, object]:
        return {"nodeId": self.entity_id, "label": self.canonical_name,
                "recommendationScore": self.recommendation_score, "evidence": self.evidence}


@dataclass(frozen=True)
class NormalizedEntity:
    """A B-internal decision. `matched` is deliberately never a submission status."""

    source_term: str
    display_name: str
    entity_type: EntityType
    status: MatchStatus
    matched_entity_ids: list[str]
    canonical_name: str | None
    candidates: list[MatchCandidate]
    selected_candidate_ids: list[str]
    recommendation_scores: dict[str, float | None]
    new_recommendation_score: float | None
    reason: str
    evidence_client_refs: list[str]


class CandidateQueryClient(Protocol):
    def query(self, entity_type: EntityType, raw_text: str, normalized_label: str, context: str | None, limit: int) -> list[MatchCandidate]:
        """Query A's bounded v0.5 candidate endpoint."""


class ANodeMatchCandidateClient:
    """HTTP client for POST /api/v1/internal/node-match-candidates only."""

    def __init__(self, base_url: str, timeout_seconds: float = 10.0) -> None:
        self._base_url = base_url.rstrip("/")
        self._timeout_seconds = timeout_seconds

    def query(self, entity_type: EntityType, raw_text: str, normalized_label: str, context: str | None, limit: int) -> list[MatchCandidate]:
        if not 1 <= limit <= 10:
            raise ValueError("candidate limit must be between 1 and 10")
        request_body = {"nodeType": entity_type, "rawText": raw_text, "normalizedLabel": normalized_label,
                        "context": context, "limit": limit}
        request = Request(f"{self._base_url}/api/v1/internal/node-match-candidates",
                          data=json.dumps(request_body).encode("utf-8"), headers={"Content-Type": "application/json"}, method="POST")
        try:
            with urlopen(request, timeout=self._timeout_seconds) as response:
                status, body = response.status, _decode_response(response.read())
        except HTTPError as error:
            status, body = error.code, _decode_response(error.read())
        except (socket.timeout, TimeoutError) as error:
            raise CandidateQueryError(f"candidate query timed out: {error}", retryable=True) from error
        except URLError as error:
            raise CandidateQueryError(f"candidate query network failure: {error}", retryable=True) from error
        if status != 200:
            raise CandidateQueryError(f"candidate query HTTP {status}", retryable=status >= 500 or _error_retryable(body))
        return _parse_candidate_response(body, entity_type)


class EntityNormalizer:
    """Owns task-scoped candidate reuse and never creates formal A node IDs."""

    def __init__(self, candidate_client: CandidateQueryClient, mode: Literal["mock", "live"], model_client: ModelClient | None = None, candidate_limit: int = 5) -> None:
        if mode == "live" and model_client is None:
            raise ValueError("live normalization requires a model client")
        if not 1 <= candidate_limit <= 10:
            raise ValueError("candidate_limit must be between 1 and 10")
        self._candidate_client, self._mode, self._model_client = candidate_client, mode, model_client
        self._candidate_limit = candidate_limit
        self._cache: dict[tuple[EntityType, str], list[MatchCandidate]] = {}

    def normalize(self, entity: RawEntity) -> NormalizedEntity:
        candidates = self._candidates_for(entity)
        if not candidates:
            return NormalizedEntity(entity.source_term, entity.display_name, entity.entity_type, "new", [], entity.display_name,
                                    [], [], {}, None, "A 未返回可匹配的正式候选。", entity.evidence_client_refs)
        decision = self._mock_decision(entity, candidates) if self._mode == "mock" else self._live_decision(entity, candidates)
        return _validate_decision(entity, candidates, decision)

    def _candidates_for(self, entity: RawEntity) -> list[MatchCandidate]:
        key = (entity.entity_type, _cache_term(entity.display_name or entity.source_term))
        if key not in self._cache:
            self._cache[key] = self._candidate_client.query(entity.entity_type, entity.source_term, entity.display_name,
                                                            entity.context, self._candidate_limit)
        return self._cache[key]

    def _live_decision(self, entity: RawEntity, candidates: list[MatchCandidate]) -> dict[str, object]:
        assert self._model_client is not None
        prompt = _render_decision_prompt(entity, candidates)
        first = self._model_client.generate("Return valid JSON only.", prompt)
        try:
            return _parse_decision(first)
        except (ValueError, json.JSONDecodeError):
            repaired = self._model_client.generate("Return valid JSON only.",
                "Repair the following output into the exact requested JSON. Do not invent IDs or fields.\n\n"
                f"Task:\n{prompt}\n\nInvalid output:\n{first}")
            return _parse_decision(repaired)

    @staticmethod
    def _mock_decision(entity: RawEntity, candidates: list[MatchCandidate]) -> dict[str, object]:
        exact = next((candidate for candidate in candidates if _cache_term(candidate.canonical_name) == _cache_term(entity.source_term)), None)
        if exact is not None:
            return _decision("matched", [exact.entity_id], [], None, [], None, "离线 mock：术语与 A 候选一致。")
        ids = [candidate.entity_id for candidate in candidates]
        scores = [{"nodeId": node_id, "recommendationScore": round(0.7 - index * 0.1, 2)} for index, node_id in enumerate(ids)]
        return _decision("uncertain", [], ids, None, scores, None, "离线 mock：保留 Existing 候选给人工审核。")


def _decision(status: str, matched_ids: list[str], candidate_ids: list[str], proposed: str | None,
              existing_scores: list[dict[str, object]], new_score: float | None, reason: str) -> dict[str, object]:
    return {"status": status, "matchedEntityIds": matched_ids, "candidateEntityIds": candidate_ids,
            "proposedCanonicalName": proposed, "existingRecommendationScores": existing_scores,
            "newRecommendationScore": new_score, "reason": reason}


def _parse_candidate_response(body: dict[str, object], expected_type: EntityType) -> list[MatchCandidate]:
    if set(body) != {"nodeType", "candidates"} or body.get("nodeType") != expected_type or not isinstance(body.get("candidates"), list):
        raise CandidateQueryError("invalid candidate response or entity type mismatch", retryable=False)
    results: list[MatchCandidate] = []
    seen: set[str] = set()
    for value in body["candidates"]:
        if not isinstance(value, dict) or set(value) != {"nodeId", "label", "recommendationScore", "evidence"}:
            raise CandidateQueryError("invalid candidate item", retryable=False)
        node_id, label, score, evidence = value["nodeId"], value["label"], value["recommendationScore"], value["evidence"]
        if not isinstance(node_id, str) or not node_id or node_id in seen or not isinstance(label, str) or not label or not isinstance(evidence, list) or not all(isinstance(item, str) for item in evidence):
            raise CandidateQueryError("invalid candidate item values", retryable=False)
        _validate_score(score, CandidateQueryError, "invalid candidate recommendationScore")
        seen.add(node_id)
        results.append(MatchCandidate(node_id, label, score, evidence))
    return results


def _render_decision_prompt(entity: RawEntity, candidates: list[MatchCandidate]) -> str:
    return (f"{INSTRUCTION}\n\n【实体类型】\n{entity.entity_type}\n【原始英文术语】\n{entity.source_term}"
            f"\n【中文展示名称】\n{entity.display_name}\n【局部上下文】\n{entity.context or ''}"
            + "\n【A 返回的有限 Existing 候选】\n" + json.dumps([candidate.to_v05_context() for candidate in candidates], ensure_ascii=False)
            + "\n【严格 JSON 模板】\n" + json.dumps(OUTPUT_TEMPLATE, ensure_ascii=False))


def _parse_decision(value: str) -> dict[str, object]:
    parsed = json.loads(value)
    expected = {"status", "matchedEntityIds", "candidateEntityIds", "proposedCanonicalName",
                "existingRecommendationScores", "newRecommendationScore", "reason"}
    if not isinstance(parsed, dict) or set(parsed) != expected:
        raise ValueError("match model output contains unsupported or missing fields")
    return parsed


def _validate_decision(entity: RawEntity, candidates: list[MatchCandidate], decision: dict[str, object]) -> NormalizedEntity:
    status, matched_ids, selected_ids = decision["status"], decision["matchedEntityIds"], decision["candidateEntityIds"]
    canonical, score_items, new_score, reason = (decision["proposedCanonicalName"], decision["existingRecommendationScores"],
                                                   decision["newRecommendationScore"], decision["reason"])
    valid_ids = {candidate.entity_id for candidate in candidates}
    if status not in {"matched", "uncertain", "new"}:
        raise NormalizationError("model returned an unsupported match status")
    if not _unique_ids(matched_ids, valid_ids) or not _unique_ids(selected_ids, valid_ids):
        raise NormalizationError("model referenced an entity outside A candidates")
    if not isinstance(reason, str) or not reason.strip():
        raise NormalizationError("normalization reason must be non-empty")
    scores = _score_map(score_items, selected_ids)
    _validate_score(new_score, NormalizationError, "invalid new recommendationScore")
    if status == "matched":
        if not 1 <= len(matched_ids) <= 3 or selected_ids or canonical is not None or scores or new_score is not None:
            raise NormalizationError("matched is internal-only and requires only one to three resolved A IDs")
        return NormalizedEntity(entity.source_term, entity.display_name, entity.entity_type, status, matched_ids, None,
                                candidates, [], {}, None, reason, entity.evidence_client_refs)
    if status == "uncertain":
        if matched_ids or not selected_ids or canonical is not None or new_score is not None:
            raise NormalizationError("uncertain requires Existing review candidates only")
        return NormalizedEntity(entity.source_term, entity.display_name, entity.entity_type, status, [], None,
                                candidates, selected_ids, scores, None, reason, entity.evidence_client_refs)
    if matched_ids or not isinstance(canonical, str) or not canonical.strip():
        raise NormalizationError("new requires a proposed canonical name and no matched IDs")
    return NormalizedEntity(entity.source_term, entity.display_name, entity.entity_type, status, [], canonical.strip(),
                            candidates, selected_ids, scores, new_score, reason, entity.evidence_client_refs)


def _unique_ids(value: object, valid_ids: set[str]) -> bool:
    return isinstance(value, list) and all(isinstance(item, str) and item in valid_ids for item in value) and len(set(value)) == len(value)


def _score_map(value: object, selected_ids: object) -> dict[str, float | None]:
    if not isinstance(selected_ids, list) or not isinstance(value, list):
        raise NormalizationError("existingRecommendationScores must match selected candidates")
    scores: dict[str, float | None] = {}
    for item in value:
        if not isinstance(item, dict) or set(item) != {"nodeId", "recommendationScore"} or not isinstance(item["nodeId"], str):
            raise NormalizationError("invalid existing recommendation score")
        node_id = item["nodeId"]
        _validate_score(item["recommendationScore"], NormalizationError, "invalid existing recommendationScore")
        if node_id in scores:
            raise NormalizationError("duplicate existing recommendation score")
        scores[node_id] = item["recommendationScore"]  # type: ignore[assignment]
    if set(scores) != set(selected_ids):
        raise NormalizationError("existingRecommendationScores must cover selected candidates exactly")
    return scores


def _validate_score(value: object, error_type: type[Exception], message: str) -> None:
    if value is not None and (not isinstance(value, (int, float)) or isinstance(value, bool) or not 0 <= value <= 1):
        raise error_type(message)


def _cache_term(value: str) -> str:
    return re.sub(r"[\W_]+", "", value.lower(), flags=re.UNICODE)


def _decode_response(raw: bytes) -> dict[str, object]:
    try:
        decoded = json.loads(raw.decode("utf-8"))
    except json.JSONDecodeError:
        return {}
    return decoded if isinstance(decoded, dict) else {}


def _error_retryable(body: dict[str, object]) -> bool:
    error = body.get("error")
    return isinstance(error, dict) and error.get("retryable") is True
