"""Evidence-bound second-pass judgments for same-paper method relations."""

from __future__ import annotations

import json
from itertools import combinations
from typing import Any

from .model_client import ModelClient


PAIR_BATCH_SIZE = 12


def add_same_paper_method_candidates(submission: dict[str, Any], model: ModelClient) -> int:
    """Add only model-confirmed combinedWith relations; plain co-use stays a weak UI signal."""
    evidence = {item["clientRef"]: item for item in submission.get("evidence", [])}
    methods = []
    for item in submission.get("methods", []):
        candidates = item.get("candidates", [])
        candidate = next((value for value in candidates if value.get("recommendationScore") is not None), None)
        candidate = candidate or (candidates[0] if candidates else None)
        refs = [ref for ref in item.get("evidenceRefs", []) if ref in evidence]
        if candidate and refs:
            methods.append({
                "label": item["normalizedLabel"],
                "candidateRef": candidate["clientRef"],
                "evidenceRefs": refs,
            })

    pairs = []
    for left, right in combinations(methods, 2):
        pairs.append({
            "pairKey": f"{left['candidateRef']}::{right['candidateRef']}",
            "left": left,
            "right": right,
        })

    added = 0
    for start in range(0, len(pairs), PAIR_BATCH_SIZE):
        batch = pairs[start:start + PAIR_BATCH_SIZE]
        decisions = _judge_batch(batch, evidence, model)
        by_key = {pair["pairKey"]: pair for pair in batch}
        for decision in decisions:
            pair = by_key.get(decision.get("pairKey"))
            if not pair or decision.get("relationType") != "combinedWith":
                continue
            confidence = decision.get("confidence")
            if not isinstance(confidence, (int, float)) or isinstance(confidence, bool) or not 0 <= confidence <= 1:
                continue
            left_refs = [ref for ref in decision.get("leftEvidenceRefs", []) if ref in pair["left"]["evidenceRefs"]]
            right_refs = [ref for ref in decision.get("rightEvidenceRefs", []) if ref in pair["right"]["evidenceRefs"]]
            if not left_refs or not right_refs:
                continue
            submission["relationCandidates"].append({
                "source": {"type": "resolutionCandidateRef", "value": pair["left"]["candidateRef"]},
                "target": {"type": "resolutionCandidateRef", "value": pair["right"]["candidateRef"]},
                "relationType": "combinedWith",
                "confidence": float(confidence),
                "evidenceRefs": list(dict.fromkeys([*left_refs, *right_refs])),
            })
            added += 1
    return added


def _judge_batch(batch: list[dict[str, Any]], evidence: dict[str, dict[str, Any]], model: ModelClient) -> list[dict[str, Any]]:
    payload = []
    for pair in batch:
        payload.append({
            "pairKey": pair["pairKey"],
            "left": {
                "method": pair["left"]["label"],
                "evidence": [
                    {"ref": ref, "section": evidence[ref].get("section"), "text": evidence[ref]["text"]}
                    for ref in pair["left"]["evidenceRefs"]
                ],
            },
            "right": {
                "method": pair["right"]["label"],
                "evidence": [
                    {"ref": ref, "section": evidence[ref].get("section"), "text": evidence[ref]["text"]}
                    for ref in pair["right"]["evidenceRefs"]
                ],
            },
        })
    prompt = (
        "你是同篇论文的方法关系审查员。只在原文表明两种方法被联合、串联或作为同一工作流配合使用时输出 combinedWith。"
        "仅仅出现在同一篇论文中不足以建立 combinedWith；证据不足的方法对不要输出。"
        "每个决定必须同时引用左右两侧证据。"
        "输出严格 JSON：{\"items\":[{\"pairKey\":string,\"relationType\":\"combinedWith\","
        "\"confidence\":0..1,\"leftEvidenceRefs\":[string],\"rightEvidenceRefs\":[string]}]}。\n"
        + json.dumps(payload, ensure_ascii=False)
    )
    try:
        parsed = json.loads(model.generate("Return valid JSON only.", prompt))
    except (ValueError, json.JSONDecodeError):
        return []
    items = parsed.get("items") if isinstance(parsed, dict) else None
    return [item for item in items if isinstance(item, dict)] if isinstance(items, list) else []
