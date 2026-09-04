"""Manual quality-evaluation schema and aggregation for the single-paper pipeline."""

from __future__ import annotations

from collections import Counter, defaultdict
import json
from pathlib import Path
from typing import Literal


QualityLabel = Literal["correct", "partially_correct", "incorrect", "missing", "hallucinated"]
MODULES = ("researchOverview", "researchQuestion", "concept", "method", "finding", "evidence", "entityCandidateRecommendation")
LABELS = ("correct", "partially_correct", "incorrect", "missing", "hallucinated")

_REMEDIATIONS = {
    "evidence_mismatch": "validator: 加强 Evidence 连续子串与 chunk 归属校验。",
    "unsupported_claim": "Prompt: 强化“无原文证据则留空”的约束。",
    "unsupported_sample": "ResearchOverviewBuilder: 保持样本数量与对象双重要求。",
    "wrong_method_type": "Method Prompt/validator: 收紧 v0.5 MethodType 定义与证据要求。",
    "wrong_normalization": "entity_match Prompt: 强化上下位概念与限定版本的区分。",
    "candidate_ranking": "entity_match Prompt: 校准 Existing 与 New 的 recommendationScore 语义。",
    "false_auto_match": "EntityNormalizer: 降低内部 matched 的适用范围，优先进入审核。",
}


def annotation_template(prediction: dict[str, object]) -> dict[str, object]:
    """Create a reviewer-owned verdict file; `missing` means the output was absent."""
    paper_id = prediction.get("paperId")
    if not isinstance(paper_id, str) or not paper_id:
        raise ValueError("prediction requires paperId")
    return {
        "paperId": paper_id,
        "title": prediction.get("title"),
        "predictionPath": prediction.get("predictionPath"),
        "modules": {name: {"label": "missing", "errorTypes": [], "note": ""} for name in MODULES},
        "entityCandidateReview": {
            "autoMatchExpectedButSentForReview": None,
            "reviewExpectedButAutoMatched": None,
            "existingCandidateRanking": "missing",
            "newCandidateReasonable": "missing",
            "note": "候选服务未运行时保持 null / missing。",
        },
    }


def load_annotations(directory: Path) -> list[dict[str, object]]:
    annotations: list[dict[str, object]] = []
    for path in sorted(directory.glob("*.json")):
        value = json.loads(path.read_text(encoding="utf-8"))
        validate_annotation(value)
        annotations.append(value)
    return annotations


def validate_annotation(value: object) -> None:
    if not isinstance(value, dict) or not isinstance(value.get("paperId"), str) or not isinstance(value.get("modules"), dict):
        raise ValueError("invalid annotation envelope")
    modules = value["modules"]
    if set(modules) != set(MODULES):
        raise ValueError("annotation must cover every evaluation module")
    for name, review in modules.items():
        if not isinstance(review, dict) or review.get("label") not in LABELS:
            raise ValueError(f"invalid label for {name}")
        if not isinstance(review.get("errorTypes"), list) or not all(isinstance(item, str) for item in review["errorTypes"]):
            raise ValueError(f"invalid errorTypes for {name}")
        if not isinstance(review.get("note"), str):
            raise ValueError(f"invalid note for {name}")
    candidate = value.get("entityCandidateReview")
    if not isinstance(candidate, dict):
        raise ValueError("entityCandidateReview is required")
    for key in ("autoMatchExpectedButSentForReview", "reviewExpectedButAutoMatched"):
        if candidate.get(key) is not None and (not isinstance(candidate[key], int) or candidate[key] < 0):
            raise ValueError(f"{key} must be a non-negative integer or null")
    for key in ("existingCandidateRanking", "newCandidateReasonable"):
        if candidate.get(key) not in LABELS:
            raise ValueError(f"invalid {key}")


def aggregate(annotations: list[dict[str, object]]) -> dict[str, object]:
    module_labels = {name: Counter() for name in MODULES}
    error_types: dict[str, Counter[str]] = {name: Counter() for name in MODULES}
    examples: dict[str, list[dict[str, str]]] = defaultdict(list)
    candidate_counts = Counter()
    candidate_labels = {"existingCandidateRanking": Counter(), "newCandidateReasonable": Counter()}
    for annotation in annotations:
        for module, review in annotation["modules"].items():  # validated before aggregation
            assert isinstance(review, dict)
            label = review["label"]
            module_labels[module][label] += 1
            for error_type in review["errorTypes"]:
                error_types[module][error_type] += 1
                if len(examples[error_type]) < 3:
                    examples[error_type].append({"paperId": annotation["paperId"], "module": module, "note": review["note"]})
        candidate = annotation["entityCandidateReview"]
        assert isinstance(candidate, dict)
        for key in ("autoMatchExpectedButSentForReview", "reviewExpectedButAutoMatched"):
            if isinstance(candidate[key], int):
                candidate_counts[key] += candidate[key]
        for key in candidate_labels:
            candidate_labels[key][candidate[key]] += 1
    recommendations = _recommendations(error_types)
    freeze = _freeze_decision(annotations, module_labels, candidate_counts)
    return {
        "paperCount": len(annotations),
        "moduleLabels": {name: dict(counts) for name, counts in module_labels.items()},
        "errorTypes": {name: dict(counts.most_common()) for name, counts in error_types.items()},
        "typicalFailures": dict(examples),
        "entityCandidateStats": {**dict(candidate_counts), **{name: dict(counts) for name, counts in candidate_labels.items()}},
        "recommendedChanges": recommendations,
        "freezeDecision": freeze,
    }


def render_markdown(report: dict[str, object]) -> str:
    lines = ["# 单篇论文 B 端质量评估", "", f"评估论文数：{report['paperCount']}", "", "## 模块标注"]
    labels = report["moduleLabels"]
    assert isinstance(labels, dict)
    for module in MODULES:
        counts = labels[module]
        assert isinstance(counts, dict)
        lines.append(f"- {module}: " + ", ".join(f"{label}={counts.get(label, 0)}" for label in LABELS))
    lines.extend(["", "## 实体审核"])
    candidate = report["entityCandidateStats"]
    assert isinstance(candidate, dict)
    lines.append(f"- 应自动匹配但进入审核：{candidate.get('autoMatchExpectedButSentForReview', 0)}")
    lines.append(f"- 应审核但错误自动匹配：{candidate.get('reviewExpectedButAutoMatched', 0)}")
    lines.extend(["", "## 优先修改"])
    for item in report["recommendedChanges"]:  # type: ignore[union-attr]
        lines.append(f"- {item}")
    freeze = report["freezeDecision"]
    assert isinstance(freeze, dict)
    lines.extend(["", "## 冻结结论", f"- {freeze['status']}: {freeze['reason']}"])
    return "\n".join(lines) + "\n"


def _recommendations(error_types: dict[str, Counter[str]]) -> list[str]:
    totals = Counter()
    for errors in error_types.values():
        totals.update(errors)
    ranked = [error for error, _ in totals.most_common(3)]
    return [_REMEDIATIONS.get(error, f"复核 {error} 的 Prompt 与 validator 约束。") for error in ranked] or ["标注完成后按最高频错误确定 Prompt / validator 修改项。"]


def _freeze_decision(annotations: list[dict[str, object]], labels: dict[str, Counter[str]], candidates: Counter[str]) -> dict[str, str]:
    if len(annotations) < 20:
        return {"status": "not_ready", "reason": "已完成标注的真实论文少于 20 篇。"}
    unreviewed = sum(counts["missing"] for counts in labels.values())
    if unreviewed:
        return {"status": "not_ready", "reason": f"仍有 {unreviewed} 个模块被标为 missing，无法完成冻结判断。"}
    critical = sum(counts["hallucinated"] for counts in labels.values())
    total = len(annotations) * len(MODULES)
    incorrect = sum(counts["incorrect"] for counts in labels.values())
    if critical or candidates["reviewExpectedButAutoMatched"]:
        return {"status": "not_ready", "reason": "存在 hallucinated 输出或应审核却错误自动匹配的实体。"}
    if incorrect / total > 0.05:
        return {"status": "not_ready", "reason": "incorrect 比例超过 5% 的冻结门槛。"}
    return {"status": "ready", "reason": "覆盖 20+ 篇、无关键幻觉或错误自动匹配，且 incorrect 比例不超过 5%。"}
