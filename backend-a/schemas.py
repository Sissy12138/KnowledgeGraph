"""v06 API 字段、枚举与基础校验。"""

from typing import Any


PAPER_STATUSES = {
    "unprocessed",
    "queued",
    "processing",
    "pendingReview",
    "completed",
    "failed",
}

JOB_STATUSES = {"queued", "processing", "completed", "failed", "cancelled"}
JOB_STAGES = {
    "queued",
    "preparing",
    "parsing",
    "analyzing",
    "storing",
    "completed",
    "failed",
    "cancelled",
}

SUGGESTION_STATUSES = {"pending", "accepted", "rejected", "superseded"}
SUGGESTION_OPERATIONS = {
    "resolveConceptMatch",
    "resolveMethodMatch",
    "addFinding",
    "addRelation",
}

METHOD_TYPES = {
    "behavioralTask",
    "electrophysiology",
    "imaging",
    "intervention",
    "molecularCellular",
    "computationalModel",
    "statisticalAnalysis",
    "other",
}

GRAPH_NODE_TYPES = {"paper", "author", "concept", "method", "finding"}
RELATION_TYPES = {
    "authored",
    "coAuthor",
    "studies",
    "uses",
    "reports",
    "supports",
    "contradicts",
    "relatedTo",
    "broaderThan",
    "cites",
}
ANALYZED_RELATION_TYPES = {
    "supports",
    "contradicts",
    "relatedTo",
    "broaderThan",
    "cites",
}

RELATION_ENDPOINTS = {
    "authored": ("author", "paper"),
    "coAuthor": ("author", "author"),
    "studies": ("paper", "concept"),
    "uses": ("paper", "method"),
    "reports": ("paper", "finding"),
    "supports": ("finding", "finding"),
    "contradicts": ("finding", "finding"),
    "relatedTo": ("concept", "concept"),
    "broaderThan": ("concept", "concept"),
    "cites": ("paper", "paper"),
}


class SchemaValidationError(ValueError):
    pass


def require_dict(value: Any, field: str) -> dict:
    if not isinstance(value, dict):
        raise SchemaValidationError(f"{field} 必须是对象")
    return value


def require_list(value: Any, field: str) -> list:
    if not isinstance(value, list):
        raise SchemaValidationError(f"{field} 必须是数组")
    return value


def require_string(value: Any, field: str, max_length: int | None = None) -> str:
    if not isinstance(value, str) or not value.strip():
        raise SchemaValidationError(f"{field} 必须是非空字符串")
    result = value.strip()
    if max_length is not None and len(result) > max_length:
        raise SchemaValidationError(f"{field} 长度不能超过 {max_length}")
    return result


def optional_string(value: Any, field: str, max_length: int | None = None) -> str | None:
    if value is None:
        return None
    if not isinstance(value, str):
        raise SchemaValidationError(f"{field} 必须是字符串或 null")
    result = value.strip()
    if max_length is not None and len(result) > max_length:
        raise SchemaValidationError(f"{field} 长度不能超过 {max_length}")
    return result or None


def optional_score(value: Any, field: str) -> float | None:
    if value is None:
        return None
    if isinstance(value, bool) or not isinstance(value, (int, float)):
        raise SchemaValidationError(f"{field} 必须是 0–1 数字或 null")
    result = float(value)
    if result < 0 or result > 1:
        raise SchemaValidationError(f"{field} 必须在 0–1 之间")
    return result


def require_enum(value: Any, field: str, allowed: set[str]) -> str:
    if value not in allowed:
        raise SchemaValidationError(f"{field} 不合法")
    return value


def ensure_unique(values: list[str], field: str) -> None:
    if len(values) != len(set(values)):
        raise SchemaValidationError(f"{field} 不能重复")
