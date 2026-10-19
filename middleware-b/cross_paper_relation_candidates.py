"""Evidence-bound, cross-paper method relation candidates for the live worker.

Candidate recall is deliberately deterministic and narrow.  The model never receives an
unbounded library, and any proposed link must point to evidence from *both* papers.
"""

from __future__ import annotations

import json
import re
from dataclasses import dataclass
from typing import Any

from .model_client import ModelClient


MAX_PAIRS = 12
MAX_EVIDENCE_PER_SIDE = 2
ALLOWED_RELATIONS = {"variantOf", "alternativeTo"}


@dataclass(frozen=True)
class ExistingMethod:
    node_id: str
    label: str
    paper_id: str
    method_type: str
    evidence: tuple[dict[str, str], ...]


def add_cross_paper_method_candidates(
    submission: dict[str, Any],
    graph: dict[str, Any],
    latest_extractions: dict[str, dict[str, Any]],
    model: ModelClient,
) -> int:
    """Append model-judged, deferred method relations and return their count.

    Existing evidence is copied into this submission while retaining its real ``paperId``.
    It can therefore be shown together with the source paper evidence in the review panel.
    """
    current_methods = _current_methods(submission)
    existing = _existing_methods(graph, latest_extractions, submission["paperId"])
    pairs = _recall_pairs(current_methods, existing)
    if not pairs:
        return 0

    evidence_by_ref = {item["clientRef"]: item for item in submission["evidence"]}
    decisions = _judge_pairs(pairs, evidence_by_ref, model)
    if not decisions:
        return 0

    existing_evidence_refs: dict[tuple[str, str], str] = {}
    added = 0
    for decision in decisions:
        pair = next((item for item in pairs if item["key"] == decision["pairKey"]), None)
        if not pair:
            continue
        relation_type = decision["relationType"]
        if relation_type not in ALLOWED_RELATIONS:
            continue
        confidence = decision["confidence"]
        if not isinstance(confidence, (int, float)) or not 0 <= confidence <= 1:
            continue
        source_refs = [
            ref for ref in decision["sourceEvidenceRefs"]
            if ref in pair["source"]["evidenceRefs"] and ref in evidence_by_ref
        ][:MAX_EVIDENCE_PER_SIDE]
        target_refs = _copy_target_evidence(
            submission, pair["target"], decision["targetEvidenceIds"], existing_evidence_refs,
        )
        if not source_refs or not target_refs:
            continue
        submission["relationCandidates"].append({
            "source": {"type": "resolutionCandidateRef", "value": pair["source"]["candidateRef"]},
            "target": {"type": "formalNodeId", "value": pair["target"].node_id},
            "relationType": relation_type,
            "confidence": float(confidence),
            "evidenceRefs": list(dict.fromkeys([*source_refs, *target_refs])),
        })
        added += 1
    return added


def _current_methods(submission: dict[str, Any]) -> list[dict[str, Any]]:
    methods = []
    for method in submission.get("methods", []):
        candidates = method.get("candidates", [])
        candidate = next((item for item in candidates if item.get("kind") == "new"), None)
        evidence_refs = method.get("evidenceRefs", [])
        if not candidate or not isinstance(evidence_refs, list) or not evidence_refs:
            continue
        methods.append({
            "candidateRef": candidate["clientRef"],
            "label": method["normalizedLabel"],
            "methodType": method["methodType"],
            "evidenceRefs": evidence_refs,
        })
    return methods


def _existing_methods(
    graph: dict[str, Any], latest_extractions: dict[str, dict[str, Any]], current_paper_id: str,
) -> list[ExistingMethod]:
    methods: list[ExistingMethod] = []
    for node in graph.get("nodes", []):
        if node.get("nodeType") != "method":
            continue
        for paper_id in node.get("sourcePaperIds", []):
            if paper_id == current_paper_id or paper_id not in latest_extractions:
                continue
            extraction = latest_extractions[paper_id]
            matched = next((item for item in extraction.get("methods", []) if node["id"] in item.get("matchedMethodIds", [])), None)
            if not matched:
                continue
            evidence_by_id = {item["id"]: item for item in extraction.get("evidence", [])}
            evidence = tuple(
                {"id": item["id"], "paperId": item["paperId"], "section": item.get("section") or "正文", "text": item["text"]}
                for evidence_id in matched.get("evidenceIds", [])
                if (item := evidence_by_id.get(evidence_id))
            )
            if evidence:
                methods.append(ExistingMethod(
                    node_id=node["id"], label=node["label"], paper_id=paper_id,
                    method_type=matched.get("methodType") or "other", evidence=evidence,
                ))
    return methods


def _recall_pairs(current: list[dict[str, Any]], existing: list[ExistingMethod]) -> list[dict[str, Any]]:
    ranked = []
    for source in current:
        for target in existing:
            lexical = _term_similarity(source["label"], target.label)
            type_bonus = 0.2 if source["methodType"] == target.method_type else 0
            score = lexical + type_bonus
            # 至少应有名称重合或相同的具体方法类别，才值得支付一次模型判断成本。
            if score < 0.2:
                continue
            ranked.append((score, source["label"], target.label, {
                "key": f"{source['candidateRef']}::{target.node_id}", "source": source, "target": target,
            }))
    ranked.sort(key=lambda item: (-item[0], item[1], item[2]))
    return [item[3] for item in ranked[:MAX_PAIRS]]


def _term_similarity(left: str, right: str) -> float:
    tokens_left = set(re.findall(r"[a-z0-9]+|[\u4e00-\u9fff]{2,}", left.casefold()))
    tokens_right = set(re.findall(r"[a-z0-9]+|[\u4e00-\u9fff]{2,}", right.casefold()))
    return len(tokens_left & tokens_right) / len(tokens_left | tokens_right) if tokens_left and tokens_right else 0.0


def _judge_pairs(
    pairs: list[dict[str, Any]], evidence_by_ref: dict[str, dict[str, Any]], model: ModelClient,
) -> list[dict[str, Any]]:
    payload = []
    for pair in pairs:
        target: ExistingMethod = pair["target"]
        payload.append({
            "pairKey": pair["key"],
            "source": {"method": pair["source"]["label"], "evidence": [
                {"ref": ref, "section": evidence_by_ref[ref].get("section") or "正文", "text": evidence_by_ref[ref]["text"]}
                for ref in pair["source"]["evidenceRefs"][:MAX_EVIDENCE_PER_SIDE]
                if ref in evidence_by_ref
            ]},
            "target": {"method": target.label, "paperId": target.paper_id, "evidence": [
                {"id": evidence["id"], "section": evidence["section"], "text": evidence["text"]}
                for evidence in target.evidence[:MAX_EVIDENCE_PER_SIDE]
            ]},
        })
    prompt = (
        "你是跨论文方法关系审查员。只根据下面每一对中的双方原文证据判断；不得仅因术语相似建立关系。"
        "仅可返回 variantOf（source 是 target 的变体/扩展）或 alternativeTo（source 可替代 target），"
        "方向固定为 source → target。证据不足时不要输出该项。"
        "每个输出必须引用 sourceEvidenceRefs 中至少一个 ref，及 targetEvidenceIds 中至少一个 id。"
        "输出严格 JSON：{\"items\":[{\"pairKey\":string,\"relationType\":\"variantOf|alternativeTo\",\"confidence\":0..1,\"sourceEvidenceRefs\":[string],\"targetEvidenceIds\":[string]}]}。\n"
        + json.dumps(payload, ensure_ascii=False)
    )
    raw = model.generate("Return valid JSON only.", prompt)
    parsed = json.loads(raw)
    items = parsed.get("items") if isinstance(parsed, dict) else None
    if not isinstance(items, list):
        return []
    allowed = {pair["key"] for pair in pairs}
    cleaned = []
    for item in items:
        if not isinstance(item, dict) or item.get("pairKey") not in allowed:
            continue
        if item.get("relationType") not in ALLOWED_RELATIONS:
            continue
        if not isinstance(item.get("sourceEvidenceRefs"), list) or not isinstance(item.get("targetEvidenceIds"), list):
            continue
        pair = next(pair for pair in pairs if pair["key"] == item["pairKey"])
        source_refs = set(pair["source"]["evidenceRefs"])
        target_ids = {evidence["id"] for evidence in pair["target"].evidence}
        if not set(item["sourceEvidenceRefs"]) <= source_refs or not set(item["targetEvidenceIds"]) <= target_ids:
            continue
        if not item["sourceEvidenceRefs"] or not item["targetEvidenceIds"]:
            continue
        cleaned.append(item)
    return cleaned


def _copy_target_evidence(
    submission: dict[str, Any], target: ExistingMethod, selected_ids: list[str], refs: dict[tuple[str, str], str],
) -> list[str]:
    result = []
    for evidence in target.evidence[:MAX_EVIDENCE_PER_SIDE]:
        if evidence["id"] not in selected_ids:
            continue
        key = (target.paper_id, evidence["id"])
        if key not in refs:
            client_ref = f"cross-paper-{target.paper_id[:8]}-{evidence['id'][:8]}"
            refs[key] = client_ref
            submission["evidence"].append({
                "clientRef": client_ref,
                "paperId": evidence["paperId"],
                "section": f"跨论文证据 · {evidence['section']}",
                "text": evidence["text"],
            })
        result.append(refs[key])
    return result
